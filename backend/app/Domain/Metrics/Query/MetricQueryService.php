<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Query;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorRegistry;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Models\IntegrationAccount;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Consulta unificada de métricas de um projeto.
 *
 * Regras de agregação (o ponto onde relatórios costumam errar):
 *  - aditiva:     soma dos dias
 *  - snapshot:    valor do último dia com dado no período
 *  - não aditiva: valor do período exato, vindo da plataforma (cacheado); nunca a soma dos dias
 *  - derivada:    fórmula aplicada aos TOTAIS do período (razão das somas, não média das razões)
 *
 * Várias contas da mesma plataforma no projeto: aditivas e snapshots somam; não aditivas somam
 * como aproximação (o mesmo público pode estar nas duas contas) e são marcadas "approximate".
 *
 * Não há filtro de agência aqui: as contas vêm do projeto, e o RLS garante o isolamento.
 */
final class MetricQueryService
{
    private MetricSet $set;

    private string $projectId = '';

    public function __construct(
        private readonly Catalog $catalog,
        private readonly ConnectorRegistry $connectors,
    ) {}

    /**
     * @return array{
     *     period: array{start: string, end: string},
     *     comparison: array{start: string, end: string}|null,
     *     metrics: list<array<string, mixed>>
     * }
     */
    public function run(MetricQuery $query): array
    {
        $byProvider = [];
        foreach ($query->project->accounts()->with('integration')->get() as $account) {
            $byProvider[$account->provider][] = $account;
        }

        $this->set = $query->set ?? MetricSet::forCurrentTenant($this->catalog);
        $baseKeys = $this->set->baseMetricsFor($query->metrics);
        $previousRange = $query->comparison->shift($query->start, $query->end);

        $this->projectId = $query->project->id;
        $current = $this->periodValues($byProvider, $baseKeys, $query->start, $query->end);
        $previous = $previousRange === null ? null : $this->periodValues($byProvider, $baseKeys, ...$previousRange);

        $series = $query->withSeries ? $this->dailySeries($byProvider, $baseKeys, $query->start, $query->end) : [];
        $previousSeries = $query->withSeries && $previousRange !== null ? $this->dailySeries($byProvider, $baseKeys, ...$previousRange) : [];

        $metrics = [];
        foreach ($query->metrics as $key) {
            $spec = $this->spec($key);
            $value = $this->resolve($key, $current->values);
            $before = $previous === null ? null : $this->resolve($key, $previous->values);
            $change = self::changePct($value, $before);

            $item = [
                'key' => $spec->key,
                'label' => $spec->label,
                'unit' => $spec->unit->value,
                'direction' => $spec->direction->value,
                'decimals' => $spec->decimals,
                'value' => self::round($value),
                'previous' => self::round($before),
                'change_pct' => $change,
                'sentiment' => $spec->direction->sentiment($change),
                'approximate' => $this->isApproximate($key, $current),
            ];

            if ($query->withSeries) {
                $item['series'] = $this->resolveSeries($key, $series);
                $item['previous_series'] = $this->resolveSeries($key, $previousSeries);
            }

            $metrics[] = $item;
        }

        return [
            'period' => ['start' => $query->start->toDateString(), 'end' => $query->end->toDateString()],
            'comparison' => $previousRange === null ? null : ['start' => $previousRange[0]->toDateString(), 'end' => $previousRange[1]->toDateString()],
            'metrics' => $metrics,
        ];
    }

    /**
     * @param  array<string, list<IntegrationAccount>>  $byProvider
     * @param  list<string>  $baseKeys
     */
    private function periodValues(array $byProvider, array $baseKeys, CarbonImmutable $start, CarbonImmutable $end): PeriodValues
    {
        $values = array_fill_keys($baseKeys, null);
        $approximate = [];
        $additive = $snapshot = $nonAdditive = [];
        foreach ($baseKeys as $key) {
            match ($this->spec($key)->kind) {
                MetricKind::Snapshot => $snapshot[] = $key,
                MetricKind::NonAdditive => $nonAdditive[] = $key,
                default => $additive[] = $key,
            };
        }

        $range = [$start->toDateString(), $end->toDateString()];

        if ($additive !== [] && ($accountIds = $this->accountIdsFor($byProvider, $additive)) !== []) {
            $rows = DB::table('metric_facts_daily')
                ->selectRaw('metric_key, sum(value) as total')
                ->whereIn('integration_account_id', $accountIds)
                ->whereIn('metric_key', $additive)
                ->whereBetween('date', $range)
                ->groupBy('metric_key')
                ->get();

            foreach ($rows as $row) {
                $values[self::str($row->metric_key)] = self::num($row->total);
            }
        }

        if ($snapshot !== [] && ($accountIds = $this->accountIdsFor($byProvider, $snapshot)) !== []) {
            $rows = DB::table('metric_facts_daily')
                ->selectRaw('DISTINCT ON (integration_account_id, metric_key) metric_key, value')
                ->whereIn('integration_account_id', $accountIds)
                ->whereIn('metric_key', $snapshot)
                ->whereBetween('date', $range)
                ->orderBy('integration_account_id')->orderBy('metric_key')->orderByDesc('date')
                ->get();

            foreach ($rows as $row) {
                $key = self::str($row->metric_key);
                $values[$key] = ($values[$key] ?? 0.0) + (self::num($row->value) ?? 0.0);
            }
        }

        foreach ($this->manualPeriod($baseKeys, $range) as $key => $value) {
            $values[$key] = $value;
        }

        foreach ($nonAdditive as $key) {
            $accounts = $byProvider[$this->spec($key)->provider()] ?? [];
            $found = 0;

            foreach ($accounts as $account) {
                $value = $this->nonAdditive($account, $key, $start, $end);
                if ($value !== null) {
                    $values[$key] = ($values[$key] ?? 0.0) + $value;
                    $found++;
                }
            }

            $approximate[$key] = $found > 1;
        }

        return new PeriodValues($values, $approximate);
    }

    /**
     * Fonte manual: soma dos dias (sum) ou último valor lançado (last), do projeto da consulta.
     *
     * @param  list<string>  $baseKeys
     * @param  array{0: string, 1: string}  $range
     * @return array<string, float|null>
     */
    private function manualPeriod(array $baseKeys, array $range): array
    {
        $manual = array_values(array_filter($baseKeys, fn (string $k): bool => $this->spec($k)->provider() === 'manual'));
        if ($manual === [] || $this->projectId === '') {
            return [];
        }

        $out = [];
        foreach ($manual as $key) {
            $base = DB::table('manual_metric_values as v')->join('manual_metrics as m', 'm.id', '=', 'v.manual_metric_id')
                ->where('v.project_id', $this->projectId)->where('m.key', $key)->whereBetween('v.date', $range);
            if ($this->spec($key)->kind === MetricKind::Snapshot) {
                $out[$key] = self::num($base->orderByDesc('v.date')->value('v.value'));
            } else {
                $out[$key] = $base->exists() ? (self::num($base->sum('v.value')) ?? 0.0) : null;
            }
        }

        return $out;
    }

    /** Valor de período de métrica não aditiva: cache em metric_period_values, senão a plataforma. */
    private function nonAdditive(IntegrationAccount $account, string $key, CarbonImmutable $start, CarbonImmutable $end): ?float
    {
        $cached = DB::table('metric_period_values')
            ->where('integration_account_id', $account->id)
            ->where('metric_key', $key)
            ->where('start_date', $start->toDateString())
            ->where('end_date', $end->toDateString())
            ->first(['value', 'fetched_at']);

        $recentWindow = ConnectionManager::yesterday()->subDays(2);
        $fresh = $cached !== null
            && ($end->lt($recentWindow) || CarbonImmutable::parse(self::str($cached->fetched_at))->gt(now()->subHours(6)));

        if ($fresh) {
            return self::num($cached->value);
        }

        $connection = $account->integration;
        if ($connection === null) {
            return null;
        }

        try {
            $value = $this->connectors->for($connection)->fetchPeriod($account, $key, $start, $end);
        } catch (ConnectorUnavailable|LiveApiException) {
            return null; // sem o valor exato, a tela mostra o aproximado (soma das contas)
        }

        DB::table('metric_period_values')->upsert([[
            'tenant_id' => $account->tenant_id,
            'integration_account_id' => $account->id,
            'metric_key' => $key,
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'value' => $value,
            'fetched_at' => now(),
        ]], ['integration_account_id', 'metric_key', 'start_date', 'end_date'], ['value', 'fetched_at']);

        return $value;
    }

    /**
     * Série diária: soma entre contas por dia (para não aditivas, o valor diário da plataforma).
     *
     * @param  array<string, list<IntegrationAccount>>  $byProvider
     * @param  list<string>  $baseKeys
     * @return array<string, array<string, float|null>> data => (métrica => valor)
     */
    private function dailySeries(array $byProvider, array $baseKeys, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $series = [];
        for ($date = $start; $date->lte($end); $date = $date->addDay()) {
            $series[$date->toDateString()] = array_fill_keys($baseKeys, null);
        }

        $manual = array_values(array_filter($baseKeys, fn (string $k): bool => $this->spec($k)->provider() === 'manual'));
        if ($manual !== []) {
            $rows = DB::table('manual_metric_values as v')->join('manual_metrics as m', 'm.id', '=', 'v.manual_metric_id')
                ->selectRaw('v.date::text as day, m.key as metric_key, v.value')
                ->where('v.project_id', $this->projectId)->whereIn('m.key', $manual)
                ->whereBetween('v.date', [$start->toDateString(), $end->toDateString()])->get();
            foreach ($rows as $row) {
                $series[self::str($row->day)][self::str($row->metric_key)] = self::num($row->value);
            }
        }

        $accountIds = $this->accountIdsFor($byProvider, $baseKeys);
        if ($accountIds === []) {
            return $series;
        }

        $rows = DB::table('metric_facts_daily')
            ->selectRaw('date::text as day, metric_key, sum(value) as total')
            ->whereIn('integration_account_id', $accountIds)
            ->whereIn('metric_key', $baseKeys)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->groupBy('date', 'metric_key')
            ->get();

        foreach ($rows as $row) {
            $series[self::str($row->day)][self::str($row->metric_key)] = self::num($row->total);
        }

        return $series;
    }

    /**
     * @param  array<string, array<string, float|null>>  $series
     * @return list<array{date: string, value: float|null}>
     */
    private function resolveSeries(string $key, array $series): array
    {
        $points = [];
        foreach ($series as $date => $values) {
            $points[] = ['date' => $date, 'value' => self::round($this->resolve($key, $values))];
        }

        return $points;
    }

    /** @param array<string, float|null> $values valores das métricas armazenadas */
    private function resolve(string $key, array $values, int $depth = 0): ?float
    {
        $spec = $this->spec($key);

        if ($spec->kind !== MetricKind::Derived) {
            return $values[$key] ?? null;
        }

        $formula = $this->set->formula($spec);
        $inputs = [];
        foreach ($formula->references() as $ref) {
            $inputs[$ref] = $depth > 16 ? null : $this->resolve($ref, $values, $depth + 1);
        }

        return $formula->evaluate($inputs);
    }

    private function isApproximate(string $key, PeriodValues $period): bool
    {
        foreach ($this->set->baseMetricsFor([$key]) as $base) {
            if ($period->approximate[$base] ?? false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, list<IntegrationAccount>>  $byProvider
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function accountIdsFor(array $byProvider, array $keys): array
    {
        $providers = array_unique(array_map(fn (string $key) => $this->spec($key)->provider(), $keys));
        $ids = [];

        foreach ($providers as $provider) {
            foreach ($byProvider[$provider] ?? [] as $account) {
                $ids[] = $account->id;
            }
        }

        return $ids;
    }

    private function spec(string $key): MetricSpec
    {
        return $this->set->metric($key) ?? throw new \InvalidArgumentException("Métrica desconhecida: {$key}");
    }

    private static function changePct(?float $current, ?float $previous): ?float
    {
        if ($current === null || $previous === null || $previous == 0.0) {
            return null;
        }

        return round(($current - $previous) / abs($previous) * 100, 2);
    }

    private static function round(?float $value): ?float
    {
        return $value === null ? null : round($value, 6);
    }

    private static function num(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}
