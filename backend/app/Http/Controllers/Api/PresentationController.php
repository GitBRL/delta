<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Ai\Copilot;
use App\Domain\Billing\Entitlements;
use App\Domain\Reports\ReportPeriod;
use App\Domain\Studio\PresentationPdf;
use App\Http\Controllers\Controller;
use App\Jobs\GeneratePresentation;
use App\Models\Presentation;
use App\Models\PresentationVersion;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Studio (ADR 0029): apresentações geradas por IA a partir de uma descrição, com ajustes por
 * chat (cada ajuste é uma versão) e exportação em PDF. Só a equipe.
 */
final class PresentationController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Presentation::query()->with('project:id,name')->orderByDesc('updated_at')->limit(200);
        if (is_string($projectId = $request->query('project_id')) && $projectId !== '') {
            $query->where('project_id', $projectId);
        }

        return response()->json(['data' => $query->get()->map(fn (Presentation $p): array => self::summary($p))->values()->all()]);
    }

    public function show(Presentation $presentation): JsonResponse
    {
        return response()->json(['data' => $this->present($presentation, $presentation->currentVersion())]);
    }

    public function version(Presentation $presentation, int $number): JsonResponse
    {
        $version = PresentationVersion::query()->where('presentation_id', $presentation->id)->where('number', $number)->firstOrFail();

        return response()->json(['data' => $this->present($presentation, $version)]);
    }

    public function store(Request $request, Copilot $copilot): JsonResponse
    {
        $request->validate([
            'project_id' => ['required', 'uuid', Rule::exists('projects', 'id')],
            'brief' => ['required', 'string', 'min:10', 'max:2000'],
            'title' => ['nullable', 'string', 'max:160'],
            'format' => ['required', Rule::in(['slides', 'page'])],
            'period_preset' => ['required', Rule::in(array_keys(ReportPeriod::PRESETS))],
            'period_start' => ['nullable', 'required_if:period_preset,custom', 'date_format:Y-m-d'],
            'period_end' => ['nullable', 'required_if:period_preset,custom', 'date_format:Y-m-d', 'after_or_equal:period_start'],
            'compare' => ['nullable', Rule::in(['previous_period', 'previous_year', 'none'])],
        ], ['brief.required' => 'Descreva a apresentação que você quer.', 'brief.min' => 'Descreva um pouco mais (pelo menos 10 caracteres).']);

        $this->ensureAiAvailable($copilot);
        $preset = $request->string('period_preset')->toString();
        $start = self::nullableString($request->input('period_start'));
        $end = self::nullableString($request->input('period_end'));
        ReportPeriod::resolve($preset, $start, $end); // valida o período (dias com dados)
        $brief = trim($request->string('brief')->toString());

        $presentation = Presentation::query()->create([
            'project_id' => $request->string('project_id')->toString(),
            'title' => self::nullableString($request->input('title')) ?? Str::limit($brief, 60),
            'brief' => $brief,
            'format' => $request->string('format')->toString(),
            'period_preset' => $preset,
            'period_start' => $start,
            'period_end' => $end,
            'compare' => self::nullableString($request->input('compare')) ?? 'previous_period',
            'created_by' => $this->context->userId(),
        ]);
        $this->audit->record('presentation.created', $presentation, ['project_id' => $presentation->project_id]);
        $this->dispatch($presentation, $presentation->brief);

        return response()->json(['data' => $this->present($presentation->refresh(), $presentation->currentVersion())], 202);
    }

    public function revise(Request $request, Presentation $presentation, Copilot $copilot): JsonResponse
    {
        $request->validate(['instruction' => ['required', 'string', 'min:3', 'max:1000']], ['instruction.required' => 'Diga o que ajustar.']);
        if ($presentation->status === 'generating') {
            throw ValidationException::withMessages(['instruction' => 'Espere a versão atual terminar de ser gerada.']);
        }
        if ($presentation->current_version === 0) {
            throw ValidationException::withMessages(['instruction' => 'A primeira versão não foi gerada; gere de novo.']);
        }
        $this->ensureAiAvailable($copilot);

        $presentation->forceFill(['status' => 'generating', 'error' => null])->save();
        $this->dispatch($presentation, $request->string('instruction')->toString());

        return response()->json(['data' => $this->present($presentation->refresh(), $presentation->currentVersion())], 202);
    }

    /** Volta para uma versão anterior (as versões nunca são apagadas). */
    public function restore(Request $request, Presentation $presentation): JsonResponse
    {
        $request->validate(['number' => ['required', 'integer', 'min:1']]);
        $number = $request->integer('number');
        abort_unless(PresentationVersion::query()->where('presentation_id', $presentation->id)->where('number', $number)->exists(), 404);
        $presentation->forceFill(['current_version' => $number, 'status' => 'ready'])->save();

        return response()->json(['data' => $this->present($presentation, $presentation->currentVersion())]);
    }

    /** Gera a primeira versão de novo depois de uma falha. */
    public function retry(Presentation $presentation, Copilot $copilot): JsonResponse
    {
        if ($presentation->status !== 'error') {
            throw ValidationException::withMessages(['presentation' => 'Só dá para tentar de novo depois de uma falha.']);
        }
        $this->ensureAiAvailable($copilot);
        $presentation->forceFill(['status' => 'generating', 'error' => null])->save();
        $this->dispatch($presentation, $presentation->brief);

        return response()->json(['data' => $this->present($presentation->refresh(), null)], 202);
    }

    public function update(Request $request, Presentation $presentation): JsonResponse
    {
        $request->validate(['title' => ['required', 'string', 'max:160']]);
        $presentation->forceFill(['title' => $request->string('title')->toString()])->save();

        return response()->json(['data' => $this->present($presentation, $presentation->currentVersion())]);
    }

    public function destroy(Presentation $presentation): Response
    {
        $this->audit->record('presentation.deleted', $presentation);
        $presentation->delete();

        return response()->noContent();
    }

    public function pdf(Presentation $presentation, PresentationPdf $pdf): Response
    {
        $version = $presentation->currentVersion() ?? abort(409, 'A apresentação ainda não tem versão pronta.');

        try {
            $content = $pdf->generate($presentation, $version);
        } catch (RuntimeException $e) {
            report($e);
            abort(503, 'O gerador de PDF está indisponível agora. Tente de novo em instantes.');
        }

        return response($content, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.Str::slug($presentation->title ?: 'apresentacao').'.pdf"',
            'Cache-Control' => 'private, no-store',
        ]);
    }

    private function ensureAiAvailable(Copilot $copilot): void
    {
        app(Entitlements::class)->ensureFeature('studio');
        $status = $copilot->status();
        if (! $status['enabled'] || ! $status['configured']) {
            throw ValidationException::withMessages(['ai' => 'O Studio usa a IA da agência, que não está configurada. Um dono ou administrador cadastra a chave em Configurações › IA.']);
        }
        if ($status['used_this_month'] >= $status['budget']) {
            throw ValidationException::withMessages(['ai' => 'O orçamento de IA da agência para este mês acabou. Um administrador pode aumentá-lo em Configurações › IA.']);
        }
    }

    private function dispatch(Presentation $presentation, string $instruction): void
    {
        try {
            GeneratePresentation::dispatch($presentation->id, $instruction);
        } catch (Throwable $e) {
            report($e); // fila síncrona: a falha já ficou registrada na apresentação
        }
    }

    private static function nullableString(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /** @return array<string, mixed> */
    private static function summary(Presentation $p): array
    {
        return [
            'id' => $p->id, 'title' => $p->title, 'format' => $p->format, 'status' => $p->status, 'error' => $p->error,
            'project' => ['id' => $p->project_id, 'name' => $p->project?->name],
            'current_version' => $p->current_version, 'period_preset' => $p->period_preset,
            'created_at' => $p->created_at?->toIso8601String(), 'updated_at' => $p->updated_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function present(Presentation $p, ?PresentationVersion $version): array
    {
        return [
            ...self::summary($p->loadMissing('project:id,name')),
            'brief' => $p->brief,
            'period_start' => $p->period_start?->toDateString(),
            'period_end' => $p->period_end?->toDateString(),
            'compare' => $p->compare,
            'version' => $version === null ? null : [
                'number' => $version->number,
                'instruction' => $version->instruction,
                'rendered' => $version->rendered,
                'unverified_numbers' => $version->unverified_numbers,
                'created_at' => $version->created_at?->toIso8601String(),
            ],
            'versions' => PresentationVersion::query()->where('presentation_id', $p->id)->orderBy('number')
                ->get(['number', 'instruction', 'created_at', 'unverified_numbers'])
                ->map(fn (PresentationVersion $v): array => ['number' => $v->number, 'instruction' => $v->instruction, 'created_at' => $v->created_at?->toIso8601String(), 'verified' => $v->unverified_numbers === []])
                ->values()->all(),
        ];
    }
}
