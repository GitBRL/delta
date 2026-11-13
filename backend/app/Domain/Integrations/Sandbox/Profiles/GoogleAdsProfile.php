<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

final class GoogleAdsProfile implements SandboxProfile
{
    public function accountName(): string
    {
        return 'Conta Google Ads (demonstração)';
    }

    public function currency(): string
    {
        return 'BRL';
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $cost = round(120 * (0.6 + 1.8 * $s->trait('scale')) * Season::factor($d, 'ads') * $s->noise('cost', $d, 0.1), 2);
        $clicks = round($cost / ((1.4 + 2.2 * $s->trait('cpc')) * $s->noise('cpc', $d, 0.08)));
        $impressions = round($clicks / ((0.035 + 0.04 * $s->trait('ctr')) * $s->noise('ctr', $d, 0.1)));
        $conversions = round($clicks * (0.03 + 0.05 * $s->trait('cvr')) * $s->noise('cvr', $d, 0.15));
        $ticket = (110 + 180 * $s->trait('ticket')) * $s->noise('ticket', $d, 0.1);
        $share = (55 + 30 * $s->trait('share')) * $s->noise('share', $d, 0.06) * (Season::isBlackFriday($d) ? 0.85 : 1.0);

        return [
            'google_ads:cost' => $cost,
            'google_ads:impressions' => $impressions,
            'google_ads:clicks' => $clicks,
            'google_ads:conversions' => $conversions,
            'google_ads:conversion_value' => round($conversions * $ticket, 2),
            'google_ads:search_impression_share' => round(min(100, max(10, $share)), 2),
        ];
    }

    public function period(string $metricKey, array $daily): ?float
    {
        $mean = $metricKey === 'google_ads:search_impression_share' ? UniqueAudience::mean($daily) : null;

        return $mean === null ? null : round($mean, 2);
    }
}
