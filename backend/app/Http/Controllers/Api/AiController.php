<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Ai\AiException;
use App\Domain\Ai\Copilot;
use App\Domain\Ai\Facts;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportLayout;
use App\Domain\Reports\ReportPeriod;
use App\Domain\Reports\ReportRenderer;
use App\Domain\Reports\ReportTemplates;
use App\Http\Controllers\Controller;
use App\Models\AiSetting;
use App\Models\Project;
use App\Models\Report;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Copiloto de IA (ADR 0021): configuração (dono/admin), análise do relatório e perguntas (equipe). */
final class AiController extends Controller
{
    public function __construct(
        private readonly Copilot $copilot,
        private readonly ReportRenderer $renderer,
        private readonly Catalog $catalog,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function status(): JsonResponse
    {
        return response()->json(['data' => $this->copilot->status()]);
    }

    public function update(Request $request): JsonResponse
    {
        $request->validate([
            'api_key' => ['nullable', 'string', 'min:20', 'max:300', 'regex:/^\S+$/'],
            'enabled' => ['boolean'],
            'monthly_token_budget' => ['required', 'integer', 'between:10000,500000000'],
        ], ['api_key.min' => 'A chave parece incompleta. Copie de novo do console do provedor.']);

        $settings = AiSetting::query()->first() ?? new AiSetting;
        $settings->forceFill([
            'enabled' => $request->boolean('enabled', true),
            'monthly_token_budget' => $request->integer('monthly_token_budget'),
            'updated_by' => $this->context->userId(),
        ]);
        if ($request->filled('api_key')) {
            $settings->api_key = $request->string('api_key')->toString();
        }
        $settings->save();
        $this->audit->record('ai.settings_updated', $settings, ['key_changed' => $request->filled('api_key')]);

        return response()->json(['data' => $this->copilot->status()]);
    }

    public function deleteKey(): JsonResponse
    {
        AiSetting::query()->first()?->forceFill(['api_key' => null])->save();

        return response()->json(['data' => $this->copilot->status()]);
    }

    /** Rascunho da análise do relatório (o que vier no corpo sobrepõe o salvo, como na prévia). */
    public function reportAnalysis(Request $request, Report $report): JsonResponse
    {
        $request->validate([
            'period_preset' => ['sometimes', Rule::in(array_keys(ReportPeriod::PRESETS))],
            'period_start' => ['nullable', 'date_format:Y-m-d'],
            'period_end' => ['nullable', 'date_format:Y-m-d'],
            'compare' => ['sometimes', Rule::enum(Comparison::class)],
            'layout' => ['sometimes', 'array'],
        ]);

        $set = MetricSet::forCurrentTenant($this->catalog);
        $period = $request->has('period_preset')
            ? ReportPeriod::resolve($request->string('period_preset')->toString(), $request->filled('period_start') ? $request->string('period_start')->toString() : null, $request->filled('period_end') ? $request->string('period_end')->toString() : null)
            : $report->period();
        $compare = $request->has('compare') ? Comparison::from($request->string('compare')->toString()) : $report->compare;
        $layout = ReportLayout::normalize($request->has('layout') ? $request->input('layout') : $report->layout, $set);
        $project = $report->project()->firstOrFail();

        $data = $this->renderer->render($project, $report->title, $layout, $period, $compare, $set);

        return $this->respond(fn (): array => $this->copilot->writeAnalysis(Facts::fromReport($data, $project->niche)));
    }

    /** Pergunta livre sobre o projeto, respondida com os números dos últimos 30 dias. */
    public function ask(Request $request, Project $project): JsonResponse
    {
        $request->validate(['question' => ['required', 'string', 'min:3', 'max:500']], ['question.required' => 'Escreva a pergunta.']);

        $set = MetricSet::forCurrentTenant($this->catalog);
        $providers = array_values(array_filter($project->accounts()->pluck('provider')->unique()->all(), 'is_string'));
        $layout = ReportLayout::normalize(ReportTemplates::build(ReportTemplates::forNiche($project->niche), $providers), $set);
        $data = $this->renderer->render($project, 'Copiloto', $layout, ReportPeriod::resolve('last_30'), Comparison::PreviousPeriod, $set);

        return $this->respond(fn (): array => $this->copilot->answer(Facts::fromReport($data, $project->niche), $request->string('question')->toString()));
    }

    /** @param callable(): array{text: string, verified: bool, unverified_numbers: list<string>, model: string} $work */
    private function respond(callable $work): JsonResponse
    {
        try {
            return response()->json(['data' => [...$work(), 'suggestion' => true]]);
        } catch (AiException $e) {
            return response()->json(['message' => $e->getMessage(), 'errors' => ['ai' => [$e->getMessage()]]], 422);
        }
    }
}
