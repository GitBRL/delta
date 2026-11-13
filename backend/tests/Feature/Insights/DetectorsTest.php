<?php

declare(strict_types=1);

use App\Domain\Insights\Benchmarks;
use App\Domain\Integrations\ConnectionManager;
use App\Models\Project;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'restaurante_delivery']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    $this->account = $meta->accounts->firstOrFail()->id;
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$this->account]], $this->headers)->assertOk();
});

/**
 * Troca os dados de demonstração por séries controladas: $daily(int $daysAgo) => [métrica => valor].
 * Dia 1 = ontem.
 */
function series(callable $daily): void
{
    $t = test();
    asTenant($t->tenant, function () use ($t, $daily): void {
        DB::table('metric_facts_daily')->where('integration_account_id', $t->account)->delete();
        DB::table('metric_period_values')->where('integration_account_id', $t->account)->delete();
        $rows = [];
        for ($ago = 1; $ago <= 40; $ago++) {
            foreach ($daily($ago) as $metric => $value) {
                $rows[] = ['tenant_id' => $t->tenant->id, 'integration_account_id' => $t->account, 'metric_key' => $metric,
                    'date' => ConnectionManager::yesterday()->subDays($ago - 1)->toDateString(), 'value' => $value, 'synced_at' => now()];
            }
        }
        DB::table('metric_facts_daily')->insert($rows);
    });
}

function signals(): array
{
    $t = test();
    $end = ConnectionManager::yesterday();

    return collect($t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/attention", [
        'start' => $end->subDays(6)->toDateString(), 'end' => $end->toDateString(),
    ], $t->headers)->assertOk()->json('data.signals'))->keyBy('rule')->all();
}

$healthy = fn (int $ago): array => ['meta_ads:spend' => 150, 'meta_ads:impressions' => 10000, 'meta_ads:reach' => 4000, 'meta_ads:link_clicks' => 160, 'meta_ads:conversions' => 6, 'meta_ads:conversion_value' => 900, 'meta_ads:leads' => 0];

it('acusa conversões zeradas com tráfego normal (rastreamento)', function () use ($healthy) {
    series(fn (int $ago) => [...$healthy($ago), 'meta_ads:conversions' => $ago === 1 ? 0 : 6]);

    $signal = signals()['tracking.meta_ads:conversions'] ?? null;
    expect($signal)->not->toBeNull()
        ->and($signal['status'])->toBe('critical')
        ->and($signal['suggestion'])->toContain('pixel');
});

it('acusa desvio do histórico do próprio cliente, com volume mínimo', function () use ($healthy) {
    // CTR de 2,0% nas 4 semanas anteriores e 1,2% na última (−40%): ainda acima do limite da regra de
    // boas práticas (0,8%), então só o histórico do cliente percebe a queda.
    series(fn (int $ago) => [...$healthy($ago), 'meta_ads:link_clicks' => $ago <= 7 ? 120 : 200]);

    $signal = signals()['history.meta_ads:ctr'] ?? null;
    expect($signal)->not->toBeNull()
        ->and($signal['status'])->toBe('attention')
        ->and($signal['evidence']['median'])->toEqual(2)
        ->and($signal['evidence']['deviation_pct'])->toEqual(-40)
        ->and($signal['explanation'])->toContain('abaixo do habitual');

    // Mesmo desvio, mas com pouco volume: não acusa.
    series(fn (int $ago) => [...$healthy($ago), 'meta_ads:impressions' => 300, 'meta_ads:link_clicks' => $ago <= 7 ? 4 : 6]);
    expect(signals())->not->toHaveKey('history.meta_ads:ctr');
});

it('compara com a faixa do nicho do projeto', function () use ($healthy) {
    // CPC de R$ 1,88 (300 ÷ 160) num nicho cuja faixa vai até R$ 1,60.
    series(fn (int $ago) => [...$healthy($ago), 'meta_ads:spend' => 300]);

    $signal = signals()['benchmark.meta_ads:cpc'] ?? null;
    expect($signal)->not->toBeNull()
        ->and($signal['status'])->toBe('attention')
        ->and($signal['evidence']['p75'])->toBe(Benchmarks::for('restaurante_delivery', 'meta_ads:cpc')['p75'])
        ->and($signal['explanation'])->toContain('acima de R$ 1,60');

    series($healthy); // R$ 0,94: dentro da faixa
    expect(signals())->not->toHaveKey('benchmark.meta_ads:cpc');
});
