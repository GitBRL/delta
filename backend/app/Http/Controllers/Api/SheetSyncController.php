<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\OAuth\OAuthRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Http\Controllers\Controller;
use App\Jobs\RunSheetSync;
use App\Models\IntegrationConnection;
use App\Models\SheetSync;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Sync (ADR 0027): exportação agendada das métricas de um projeto para Google Sheets.
 * Só a equipe da agência (RLS + middleware staff). O destino é uma conexão "google_sheets",
 * criada pelo mesmo login em pop-up das integrações.
 */
final class SheetSyncController extends Controller
{
    public function __construct(
        private readonly Catalog $catalog,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function destinations(OAuthRegistry $registry): JsonResponse
    {
        return response()->json(['meta' => [
            // Para o botão "Conectar Google Sheets": login real disponível? (depende do app do Google da agência)
            'modes' => $registry->modes('google_sheets'),
            'live_note' => $registry->liveNote('google_sheets'),
        ], 'data' => IntegrationConnection::query()->whereIn('provider', array_keys(ConnectionManager::DESTINATIONS))
            ->orderBy('created_at')->get()->map(fn (IntegrationConnection $c): array => [
                'id' => $c->id,
                'provider' => $c->provider,
                'label' => $c->label,
                'mode' => $c->mode,
                'status' => $c->status,
                'created_at' => $c->created_at?->toIso8601String(),
            ])->values()->all()]);
    }

    public function destroyDestination(IntegrationConnection $connection): Response
    {
        abort_unless(ConnectionManager::isDestination($connection->provider), 404);
        $this->audit->record('connection.removed', $connection, ['provider' => $connection->provider, 'destination' => true]);
        $connection->delete(); // as exportações que usavam este destino vão junto

        return response()->noContent();
    }

    public function index(Request $request): JsonResponse
    {
        $query = SheetSync::query()->with(['project:id,name', 'destination:id,label,mode,status'])->orderBy('created_at');
        if (is_string($projectId = $request->query('project_id')) && $projectId !== '') {
            $query->where('project_id', $projectId);
        }

        return response()->json(['data' => $query->get()->map(fn (SheetSync $s): array => $this->present($s))->values()->all()]);
    }

    public function show(SheetSync $sheetSync): JsonResponse
    {
        return response()->json(['data' => $this->present($sheetSync->load(['project:id,name', 'destination:id,label,mode,status']), withPreview: true)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, creating: true);
        $sync = SheetSync::query()->create([...$data, 'created_by' => $this->context->userId()]);
        $this->audit->record('sheet_sync.created', $sync, ['project_id' => $sync->project_id]);
        $this->dispatch($sync);

        return response()->json(['data' => $this->present($sync->refresh()->load(['project:id,name', 'destination:id,label,mode,status']))], 201);
    }

    public function update(Request $request, SheetSync $sheetSync): JsonResponse
    {
        $sheetSync->fill($this->validated($request, creating: false))->save();
        $this->audit->record('sheet_sync.updated', $sheetSync, ['changed' => array_keys($sheetSync->getChanges())]);

        return response()->json(['data' => $this->present($sheetSync->load(['project:id,name', 'destination:id,label,mode,status']))]);
    }

    public function destroy(SheetSync $sheetSync): Response
    {
        $this->audit->record('sheet_sync.removed', $sheetSync, ['project_id' => $sheetSync->project_id]);
        $sheetSync->delete();

        return response()->noContent();
    }

    public function run(SheetSync $sheetSync): JsonResponse
    {
        if (! $sheetSync->active) {
            throw ValidationException::withMessages(['sync' => 'Ative a exportação para rodar.']);
        }
        $this->dispatch($sheetSync);

        return response()->json(['data' => $this->present($sheetSync->refresh()->load(['project:id,name', 'destination:id,label,mode,status']))], 202);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        /** @var array<string, mixed> $data */
        $data = $request->validate([
            'project_id' => [$creating ? 'required' : 'prohibited', 'uuid', Rule::exists('projects', 'id')],
            'connection_id' => [$creating ? 'required' : 'prohibited', 'uuid',
                Rule::exists('connections', 'id')->whereIn('provider', array_keys(ConnectionManager::DESTINATIONS))],
            'name' => [$required, 'string', 'min:1', 'max:120'],
            'metrics' => [$required, 'array', 'min:1', 'max:30'],
            'metrics.*' => ['string', 'distinct'],
            'days' => [$required, 'integer', 'between:7,400'],
            'frequency' => [$required, Rule::in(['daily', 'weekly'])],
            'active' => ['sometimes', 'boolean'],
        ], [
            'connection_id.exists' => 'Escolha um destino Google Sheets conectado.',
            'project_id.exists' => 'Projeto não encontrado.',
            'metrics.required' => 'Escolha ao menos uma métrica.',
        ]);

        if (isset($data['metrics']) && is_array($data['metrics'])) {
            $set = MetricSet::forCurrentTenant($this->catalog);
            $unknown = array_values(array_filter($data['metrics'], fn (mixed $k): bool => ! is_string($k) || $set->metric($k) === null));
            if ($unknown !== []) {
                throw ValidationException::withMessages(['metrics' => 'Métrica desconhecida: '.implode(', ', array_map('strval', array_filter($unknown, 'is_string'))).'.']);
            }
            $data['metrics'] = array_values($data['metrics']);
        }

        return $data;
    }

    private function dispatch(SheetSync $sync): void
    {
        try {
            RunSheetSync::dispatch($sync->id);
        } catch (Throwable $e) {
            report($e); // fila síncrona: a falha já ficou registrada na exportação
        }
    }

    /** @return array<string, mixed> */
    private function present(SheetSync $s, bool $withPreview = false): array
    {
        return [
            'id' => $s->id,
            'name' => $s->name,
            'project' => $s->project === null ? null : ['id' => $s->project->id, 'name' => $s->project->name],
            'destination' => $s->destination === null ? null : ['id' => $s->destination->id, 'label' => $s->destination->label, 'mode' => $s->destination->mode, 'status' => $s->destination->status],
            'metrics' => $s->metrics,
            'days' => $s->days,
            'frequency' => $s->frequency,
            'active' => $s->active,
            'spreadsheet_url' => $s->spreadsheet_url,
            'last_run_at' => $s->last_run_at?->toIso8601String(),
            'last_status' => $s->last_status,
            'last_error' => $s->last_error,
            ...($withPreview ? ['preview' => $s->last_preview] : ['has_preview' => $s->last_preview !== null]),
            'created_at' => $s->created_at?->toIso8601String(),
        ];
    }
}
