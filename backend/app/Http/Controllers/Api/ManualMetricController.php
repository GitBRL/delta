<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Domain\Metrics\Manual\ManualImport;
use App\Http\Controllers\Controller;
use App\Models\CustomMetric;
use App\Models\ManualMetric;
use App\Models\ManualMetricValue;
use App\Models\Project;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Fonte manual de dados (ADR 0015): métricas da agência e valores por projeto e dia.
 * Leitura para quem enxerga o projeto; escrita da equipe (middleware "staff").
 */
final class ManualMetricController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => ManualMetric::query()->orderBy('name')->get()->map(self::present(...))->values()->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->validateDefinition($request);
        $key = ManualMetric::PREFIX.Str::limit(Str::snake(Str::ascii($request->string('name')->toString())), 60, '');

        if (ManualMetric::query()->where('key', $key)->exists() || CustomMetric::query()->where('key', 'custom:'.substr($key, 7))->exists()) {
            throw ValidationException::withMessages(['name' => 'Já existe uma métrica com este nome.']);
        }

        $metric = ManualMetric::query()->create([...$this->definition($request), 'key' => $key, 'created_by' => $this->context->userId()]);
        $this->audit->record('manual_metric.created', $metric, ['key' => $key]);

        return response()->json(['data' => self::present($metric)], 201);
    }

    public function update(Request $request, ManualMetric $manualMetric): JsonResponse
    {
        $this->validateDefinition($request);
        $manualMetric->fill($this->definition($request))->save();

        return response()->json(['data' => self::present($manualMetric)]);
    }

    public function destroy(ManualMetric $manualMetric): Response
    {
        $users = CustomMetric::query()->whereJsonContains('references', $manualMetric->key)->pluck('name')->all();
        if ($users !== []) {
            throw ValidationException::withMessages(['metric' => 'Usada pelos indicadores: '.implode(', ', array_filter($users, 'is_string')).'. Ajuste-os antes de excluir.']);
        }

        $this->audit->record('manual_metric.deleted', $manualMetric, ['key' => $manualMetric->key]);
        $manualMetric->delete();

        return response()->noContent();
    }

    public function values(Request $request, Project $project): JsonResponse
    {
        $request->validate(['metric_id' => ['required', 'uuid'], 'start' => ['nullable', 'date_format:Y-m-d'], 'end' => ['nullable', 'date_format:Y-m-d']]);

        $query = ManualMetricValue::query()->where('project_id', $project->id)->where('manual_metric_id', $request->string('metric_id')->toString());
        if ($request->filled('start')) {
            $query->where('date', '>=', $request->string('start')->toString());
        }
        if ($request->filled('end')) {
            $query->where('date', '<=', $request->string('end')->toString());
        }

        return response()->json(['data' => $query->orderBy('date')->limit(2000)->get()->map(fn (ManualMetricValue $v): array => [
            'date' => $v->date->toDateString(),
            'value' => (float) $v->value,
        ])->values()->all()]);
    }

    /** Lançamento em lote: valor nulo apaga o dia. */
    public function save(Request $request, Project $project): JsonResponse
    {
        $request->validate([
            'metric_id' => ['required', 'uuid'],
            'entries' => ['required', 'array', 'min:1', 'max:'.ManualImport::MAX_ROWS],
            'entries.*.date' => ['required', 'date_format:Y-m-d'],
            'entries.*.value' => ['present', 'nullable', 'numeric', 'between:-1000000000000,1000000000000'],
        ]);
        $metric = $this->metric($request);

        /** @var list<array{date: string, value: float|null}> $entries */
        $entries = array_map(fn (mixed $e): array => [
            'date' => is_array($e) && is_string($e['date'] ?? null) ? $e['date'] : '',
            'value' => is_array($e) && is_numeric($e['value'] ?? null) ? (float) $e['value'] : null,
        ], (array) $request->input('entries'));

        $result = $this->apply($metric, $project, $entries);
        $this->audit->record('manual_values.saved', $metric, ['project_id' => $project->id, ...$result]);

        return response()->json(['data' => $result]);
    }

    /** Planilha colada ou CSV ("data;valor"): mostra os erros linha a linha e grava o que estiver certo. */
    public function import(Request $request, Project $project): JsonResponse
    {
        $request->validate(['metric_id' => ['required', 'uuid'], 'csv' => ['required', 'string', 'max:200000']]);
        $metric = $this->metric($request);
        $parsed = ManualImport::parse($request->string('csv')->toString());

        $result = $parsed['rows'] === [] ? ['saved' => 0, 'deleted' => 0] : $this->apply($metric, $project, $parsed['rows']);
        $this->audit->record('manual_values.imported', $metric, ['project_id' => $project->id, ...$result, 'errors' => count($parsed['errors'])]);

        return response()->json(['data' => [...$result, 'errors' => $parsed['errors']]]);
    }

    /**
     * @param  list<array{date: string, value: float|null}>  $entries
     * @return array{saved: int, deleted: int}
     */
    private function apply(ManualMetric $metric, Project $project, array $entries): array
    {
        return DB::transaction(function () use ($metric, $project, $entries): array {
            $saved = $deleted = 0;
            foreach ($entries as $entry) {
                $match = ['manual_metric_id' => $metric->id, 'project_id' => $project->id, 'date' => $entry['date']];
                if ($entry['value'] === null) {
                    $removed = ManualMetricValue::query()->where($match)->delete();
                    $deleted += is_int($removed) ? $removed : 0;

                    continue;
                }

                ManualMetricValue::query()->updateOrCreate($match, ['value' => $entry['value'], 'updated_by' => $this->context->userId()]);
                $saved++;
            }

            return ['saved' => $saved, 'deleted' => $deleted];
        });
    }

    private function metric(Request $request): ManualMetric
    {
        return ManualMetric::query()->find($request->string('metric_id')->toString())
            ?? throw ValidationException::withMessages(['metric_id' => 'Métrica manual não encontrada.']);
    }

    private function validateDefinition(Request $request): void
    {
        $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:80', 'regex:/[A-Za-zÀ-ÿ]/'],
            'description' => ['nullable', 'string', 'max:300'],
            'unit' => ['required', Rule::enum(MetricUnit::class)],
            'direction' => ['required', Rule::enum(MetricDirection::class)],
            'decimals' => ['required', 'integer', 'between:0,6'],
            'aggregation' => ['required', Rule::in(['sum', 'last'])],
        ], ['name.required' => 'Dê um nome à métrica.', 'aggregation.in' => 'Escolha "somar os dias" ou "último valor".']);
    }

    /** @return array<string, mixed> */
    private function definition(Request $request): array
    {
        return [
            'name' => $request->string('name')->toString(),
            'description' => $request->filled('description') ? $request->string('description')->toString() : null,
            'unit' => $request->string('unit')->toString(),
            'direction' => $request->string('direction')->toString(),
            'decimals' => $request->integer('decimals'),
            'aggregation' => $request->string('aggregation')->toString(),
        ];
    }

    /** @return array<string, mixed> */
    private static function present(ManualMetric $m): array
    {
        return [
            'id' => $m->id,
            'key' => $m->key,
            'name' => $m->name,
            'description' => $m->description,
            'unit' => $m->unit->value,
            'direction' => $m->direction->value,
            'decimals' => $m->decimals,
            'aggregation' => $m->aggregation,
            'created_at' => $m->created_at?->toIso8601String(),
        ];
    }
}
