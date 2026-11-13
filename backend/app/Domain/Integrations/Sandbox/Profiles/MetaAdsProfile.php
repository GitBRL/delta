<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

final class MetaAdsProfile implements SandboxProfile
{
    public function accountName(): string
    {
        return 'Conta de anúncios (demonstração)';
    }

    public function currency(): string
    {
        return 'BRL';
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $spend = round(150 * (0.6 + 1.8 * $s->trait('scale')) * Season::factor($d, 'ads') * $s->noise('spend', $d, 0.12), 2);
        $cpm = (22 + 10 * $s->trait('cpm')) * $s->noise('cpm', $d, 0.08) * (Season::isBlackFriday($d) ? 1.3 : 1.0);
        $impressions = round($spend / $cpm * 1000);
        $reach = round($impressions / (1.12 + 0.2 * $s->trait('freq')));
        $clicks = round($impressions * (0.009 + 0.012 * $s->trait('ctr')) * $s->noise('ctr', $d, 0.1));
        $conversions = round($clicks * (0.015 + 0.03 * $s->trait('cvr')) * $s->noise('cvr', $d, 0.15));
        $ticket = (90 + 160 * $s->trait('ticket')) * $s->noise('ticket', $d, 0.1);
        $leads = round($clicks * (0.03 + 0.05 * $s->trait('leads')) * $s->noise('leads', $d, 0.2));

        return [
            'meta_ads:spend' => $spend,
            'meta_ads:impressions' => $impressions,
            'meta_ads:reach' => $reach,
            'meta_ads:link_clicks' => $clicks,
            'meta_ads:conversions' => $conversions,
            'meta_ads:conversion_value' => round($conversions * $ticket, 2),
            'meta_ads:leads' => $leads,
        ];
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return $metricKey === 'meta_ads:reach' ? UniqueAudience::of($daily, 0.38) : null;
    }
}
