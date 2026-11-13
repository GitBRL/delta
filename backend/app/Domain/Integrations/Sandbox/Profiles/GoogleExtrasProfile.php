<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

/** Dados de demonstração do Search Console, do YouTube e do Perfil da Empresa no Google. */
final readonly class GoogleExtrasProfile implements SandboxProfile
{
    private function __construct(private string $kind) {}

    public static function searchConsole(): self
    {
        return new self('search_console');
    }

    public static function youtube(): self
    {
        return new self('youtube');
    }

    public static function business(): self
    {
        return new self('google_business');
    }

    public function accountName(): string
    {
        return match ($this->kind) {
            'search_console' => 'sc-domain:exemplo.com.br (demonstração)',
            'youtube' => 'Canal no YouTube (demonstração)',
            default => 'Unidade no Google Maps (demonstração)',
        };
    }

    public function currency(): ?string
    {
        return null;
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        return match ($this->kind) {
            'search_console' => $this->searchConsoleDay($s, $d),
            'youtube' => $this->youtubeDay($s, $d),
            default => $this->businessDay($s, $d),
        };
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return null;
    }

    /** @return array<string, float> */
    private function searchConsoleDay(Seed $s, CarbonImmutable $d): array
    {
        $impressions = round(2500 * (0.4 + 2.2 * $s->trait('scale')) * Season::factor($d, 'analytics') * $s->noise('imp', $d, 0.08));
        $position = 6 + 14 * $s->trait('position') + 1.5 * ($s->noise('pos', $d, 0.1) - 1) * 10;
        $ctr = max(0.006, 0.09 / max(1.0, $position / 3)) * $s->noise('ctr', $d, 0.08);

        return [
            'search_console:impressions' => $impressions,
            'search_console:clicks' => round($impressions * $ctr),
            'search_console:position_sum' => round($impressions * max(1.0, $position), 2),
        ];
    }

    /** @return array<string, float> */
    private function youtubeDay(Seed $s, CarbonImmutable $d): array
    {
        $views = round(900 * (0.3 + 2.5 * $s->trait('scale')) * Season::factor($d, 'social') * $s->noise('views', $d, 0.25));
        $gained = round($views * (0.004 + 0.01 * $s->trait('sub')) * $s->noise('gain', $d, 0.3));
        $base = 8000 + 60000 * $s->trait('base');
        $days = (int) CarbonImmutable::parse('2026-01-01')->diffInDays($d, false);

        return [
            'youtube:views' => $views,
            'youtube:watch_minutes' => round($views * (1.8 + 3.5 * $s->trait('watch')) * $s->noise('watch', $d, 0.1)),
            'youtube:subscribers_gained' => $gained,
            'youtube:subscribers_lost' => round($gained * (0.15 + 0.2 * $s->trait('churn')) * $s->noise('lost', $d, 0.3)),
            'youtube:subscribers' => round($base + $days * (6 + 20 * $s->trait('sub'))),
            'youtube:likes' => round($views * (0.03 + 0.03 * $s->trait('likes')) * $s->noise('likes', $d, 0.15)),
            'youtube:comments' => round($views * (0.002 + 0.004 * $s->trait('comments')) * $s->noise('comments', $d, 0.3)),
            'youtube:shares' => round($views * (0.002 + 0.003 * $s->trait('shares')) * $s->noise('shares', $d, 0.3)),
        ];
    }

    /** @return array<string, float> */
    private function businessDay(Seed $s, CarbonImmutable $d): array
    {
        $impressions = round(400 * (0.4 + 2.0 * $s->trait('scale')) * Season::factor($d, 'analytics') * $s->noise('imp', $d, 0.12));

        return [
            'google_business:impressions' => $impressions,
            'google_business:calls' => round($impressions * (0.006 + 0.01 * $s->trait('calls')) * $s->noise('calls', $d, 0.3)),
            'google_business:website_clicks' => round($impressions * (0.01 + 0.015 * $s->trait('web')) * $s->noise('web', $d, 0.25)),
            'google_business:directions' => round($impressions * (0.008 + 0.012 * $s->trait('dir')) * $s->noise('dir', $d, 0.25)),
        ];
    }
}
