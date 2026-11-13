<?php

declare(strict_types=1);

namespace App\Domain\Ads;

use App\Domain\Integrations\Sandbox\Seed;
use App\Models\IntegrationAccount;
use App\Models\SandboxAdObject;
use Illuminate\Support\Facades\DB;

/**
 * Conta em demonstração: campanhas e conjuntos determinísticos (pelo id da conta), gravados na
 * primeira consulta para que pausar e mudar orçamento persistam. Nada é enviado à Meta.
 */
final class SandboxAdsGateway implements AdsGateway
{
    private const CAMPAIGNS = [
        ['Conversões · Público quente', 'OUTCOME_SALES'],
        ['Remarketing · Visitantes 30 dias', 'OUTCOME_SALES'],
        ['Tráfego · Lookalike 1%', 'OUTCOME_TRAFFIC'],
        ['Leads · Formulário nativo', 'OUTCOME_LEADS'],
        ['Reconhecimento · Região', 'OUTCOME_AWARENESS'],
    ];

    private const ADSETS = ['Interesses amplos', 'Lookalike 1%', 'Remarketing 7 dias'];

    public function campaigns(IntegrationAccount $account): array
    {
        $this->seed($account);
        $seed = new Seed($account->external_id);
        $campaigns = [];
        /** @var array<string, list<SandboxAdObject>> $adsets */
        $adsets = [];
        foreach (SandboxAdObject::query()->where('account_id', $account->id)->orderBy('external_id')->get() as $row) {
            if ($row->level === 'campaign') {
                $campaigns[] = $row;
            } else {
                $adsets[(string) $row->parent_external_id][] = $row;
            }
        }

        $out = [];
        foreach ($campaigns as $c) {
            $children = [];
            $childBudget = 0.0;
            foreach ($adsets[$c->external_id] ?? [] as $a) {
                $budget = $a->daily_budget === null ? null : (float) $a->daily_budget;
                $childBudget += $a->status === 'ACTIVE' ? ($budget ?? 0.0) : 0.0;
                $children[] = [
                    'id' => $a->external_id, 'name' => $a->name, 'status' => $a->status,
                    'daily_budget' => $budget, 'lifetime_budget' => null,
                    'spend_7d' => $a->status === 'ACTIVE' ? round(($budget ?? 0.0) * 7 * (0.85 + 0.2 * $seed->trait("s{$a->external_id}")), 2) : 0.0,
                ];
            }
            $budget = $c->daily_budget === null ? null : (float) $c->daily_budget;
            $spend = $c->status === 'ACTIVE' ? round(($budget ?? $childBudget) * 7 * (0.85 + 0.2 * $seed->trait("s{$c->external_id}")), 2) : 0.0;
            if ($budget === null && $c->status === 'ACTIVE') {
                $spend = round(array_sum(array_column($children, 'spend_7d')), 2);
            }

            $out[] = [
                'id' => $c->external_id, 'name' => $c->name, 'status' => $c->status, 'objective' => $c->objective,
                'daily_budget' => $budget, 'lifetime_budget' => null,
                'spend_7d' => $spend,
                'results_7d' => round($spend / (35 + 45 * $seed->trait("cpa{$c->external_id}"))),
                'adsets' => $children,
            ];
        }

        return $out;
    }

    public function setStatus(IntegrationAccount $account, string $objectId, string $status): void
    {
        SandboxAdObject::query()->where('account_id', $account->id)->where('external_id', $objectId)->update(['status' => $status, 'updated_at' => now()]);
    }

    public function setDailyBudget(IntegrationAccount $account, string $objectId, float $amount): void
    {
        SandboxAdObject::query()->where('account_id', $account->id)->where('external_id', $objectId)->update(['daily_budget' => round($amount, 2), 'updated_at' => now()]);
    }

    private function seed(IntegrationAccount $account): void
    {
        if (SandboxAdObject::query()->where('account_id', $account->id)->exists()) {
            return;
        }

        $seed = new Seed($account->external_id);
        $count = 3 + (int) floor($seed->trait('campaigns') * 3);
        $base = 120200000000000 + (int) floor($seed->trait('base') * 1_000_000) * 100;

        DB::transaction(function () use ($account, $seed, $count, $base): void {
            for ($i = 0; $i < $count; $i++) {
                [$name, $objective] = self::CAMPAIGNS[$i];
                $campaignId = (string) ($base + $i * 10);
                $cbo = $seed->trait("cbo{$i}") < 0.4;
                SandboxAdObject::query()->create([
                    'account_id' => $account->id, 'external_id' => $campaignId, 'level' => 'campaign', 'name' => $name, 'objective' => $objective,
                    'status' => $i === $count - 1 && $seed->trait('paused') < 0.5 ? 'PAUSED' : 'ACTIVE',
                    'daily_budget' => $cbo ? round(60 + 240 * $seed->trait("b{$i}")) : null,
                ]);

                $adsets = 1 + (int) floor($seed->trait("a{$i}") * 3);
                for ($j = 0; $j < $adsets; $j++) {
                    SandboxAdObject::query()->create([
                        'account_id' => $account->id, 'external_id' => (string) ($base + $i * 10 + $j + 1), 'level' => 'adset',
                        'parent_external_id' => $campaignId, 'name' => self::ADSETS[$j], 'status' => 'ACTIVE',
                        'daily_budget' => $cbo ? null : round(20 + 120 * $seed->trait("ab{$i}{$j}")),
                    ]);
                }
            }
        });
    }
}
