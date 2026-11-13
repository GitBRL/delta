<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

/** TikTok: CPM baixo, muita visualização de vídeo, CTR e conversão menores que na Meta. */
final class TikTokAdsProfile implements SandboxProfile
{
    public function accountName(): string
    {
        return 'Anunciante TikTok (demonstração)';
    }

    public function currency(): string
    {
        return 'BRL';
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $spend = round(90 * (0.5 + 1.6 * $s->trait('scale')) * Season::factor($d, 'ads') * $s->noise('spend', $d, 0.15), 2);
        $cpm = (9 + 6 * $s->trait('cpm')) * $s->noise('cpm', $d, 0.1);
        $impressions = round($spend / $cpm * 1000);
        $views = round($impressions * (0.35 + 0.2 * $s->trait('views')) * $s->noise('views', $d, 0.08));
        $clicks = round($impressions * (0.005 + 0.008 * $s->trait('ctr')) * $s->noise('ctr', $d, 0.12));

        return [
            'tiktok_ads:spend' => $spend,
            'tiktok_ads:impressions' => $impressions,
            'tiktok_ads:reach' => round($impressions / (1.25 + 0.3 * $s->trait('freq'))),
            'tiktok_ads:clicks' => $clicks,
            'tiktok_ads:video_views' => $views,
            'tiktok_ads:video_completions' => round($views * (0.08 + 0.1 * $s->trait('completion')) * $s->noise('completion', $d, 0.1)),
            'tiktok_ads:conversions' => round($clicks * (0.01 + 0.025 * $s->trait('cvr')) * $s->noise('cvr', $d, 0.2)),
        ];
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return $metricKey === 'tiktok_ads:reach' ? UniqueAudience::of($daily, 0.42) : null;
    }
}
