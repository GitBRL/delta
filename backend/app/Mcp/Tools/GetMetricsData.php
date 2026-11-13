<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Domain\Reports\ReportPeriod;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Validation\ValidationException;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('get_metrics_data')]
#[IsReadOnly]
#[Description('Valores de métricas de um projeto num período, com a comparação (período anterior ou ano anterior) e, se pedido, a série diária. As derivadas (CPA, ROAS, CTR) são recalculadas do total, nunca média de médias.')]
final class GetMetricsData extends DeltaTool
{
    protected function scope(): string
    {
        return 'metrics:read';
    }

    public function handle(Request $request, MetricQueryService $service): Response
    {
        $project = $this->project($request);
        if ($project === null) {
            return self::projectNotFound();
        }

        $request->validate([
            'metrics' => ['required', 'array', 'min:1', 'max:30'],
            'metrics.*' => ['string', 'max:120'],
            'period' => ['nullable', 'string', 'in:'.implode(',', array_keys(ReportPeriod::PRESETS))],
            'start' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d'],
            'end' => ['nullable', 'required_if:period,custom', 'date_format:Y-m-d'],
            'compare' => ['nullable', 'in:previous_period,previous_year,none'],
            'series' => ['nullable', 'boolean'],
        ], ['metrics.required' => 'Informe ao menos uma métrica (chaves de list_metrics).']);

        $start = $request->get('start');
        $end = $request->get('end');
        $compare = $request->get('compare');
        /** @var list<string> $metrics */
        $metrics = array_values(array_filter((array) $request->get('metrics'), 'is_string'));

        try {
            $period = ReportPeriod::resolve(
                is_string($p = $request->get('period')) ? $p : 'last_30',
                is_string($start) ? $start : null,
                is_string($end) ? $end : null,
            );

            $result = $service->run(new MetricQuery(
                project: $project,
                start: $period->start,
                end: $period->end,
                comparison: Comparison::tryFrom(is_string($compare) ? $compare : '') ?? Comparison::PreviousPeriod,
                metrics: $metrics,
                withSeries: (bool) $request->get('series', false),
            ));
        } catch (ValidationException $e) {
            return Response::error(collect($e->errors())->flatten()->filter(fn (mixed $m): bool => is_string($m))->implode(' '));
        }

        return Response::json($result);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'project_id' => $schema->string()->description('Id do projeto (de list_projects).')->required(),
            'metrics' => $schema->array()->items($schema->string())->description('Chaves das métricas (de list_metrics), ex.: ["meta_ads:spend", "meta_ads:cpa"].')->required(),
            'period' => $schema->string()->enum(array_keys(ReportPeriod::PRESETS))->description('Período. Padrão: last_30. Com "custom", informe start e end.'),
            'start' => $schema->string()->description('Início (AAAA-MM-DD), só com period=custom.'),
            'end' => $schema->string()->description('Fim (AAAA-MM-DD), só com period=custom.'),
            'compare' => $schema->string()->enum(['previous_period', 'previous_year', 'none'])->description('Comparação. Padrão: previous_period.'),
            'series' => $schema->boolean()->description('Incluir a série diária (respostas maiores).'),
        ];
    }
}
