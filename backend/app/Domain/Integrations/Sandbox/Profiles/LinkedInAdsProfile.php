<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

/** LinkedIn (B2B): CPM e CPC altos, poucos cliques, leads caros e mais fracos no fim de semana. */
final class LinkedInAdsProfile implements SandboxProfile
{
    public function accountName(): string
    {
        return 'Conta de anúncios LinkedIn (demonstração)';
    }

    public function currency(): string
    {
        return 'BRL';
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $weekend = $d->isWeekend() ? 0.45 : 1.0;
        $spend = round(120 * (0.5 + 1.5 * $s->trait('scale')) * $weekend * Season::factor($d, 'ads') * $s->noise('spend', $d, 0.12), 2);
        $cpm = (95 + 60 * $s->trait('cpm')) * $s->noise('cpm', $d, 0.08);
        $impressions = round($spend / $cpm * 1000);
        $clicks = round($impressions * (0.004 + 0.006 * $s->trait('ctr')) * $s->noise('ctr', $d, 0.15));

        return [
            'linkedin_ads:spend' => $spend,
            'linkedin_ads:impressions' => $impressions,
            'linkedin_ads:clicks' => $clicks,
            'linkedin_ads:engagements' => round($clicks * (1.3 + 0.5 * $s->trait('eng')) * $s->noise('eng', $d, 0.1)),
            'linkedin_ads:leads' => round($clicks * (0.06 + 0.06 * $s->trait('leads')) * $s->noise('leads', $d, 0.25)),
            'linkedin_ads:conversions' => round($clicks * (0.01 + 0.02 * $s->trait('cvr')) * $s->noise('cvr', $d, 0.25)),
        ];
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return null;
    }
}
