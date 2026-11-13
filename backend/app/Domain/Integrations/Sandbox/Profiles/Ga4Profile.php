<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

final class Ga4Profile implements SandboxProfile
{
    public function accountName(): string
    {
        return 'Propriedade do site (demonstração)';
    }

    public function currency(): string
    {
        return 'BRL';
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $sessions = round(600 * (0.5 + 2.5 * $s->trait('scale')) * Season::factor($d, 'analytics') * $s->noise('sessions', $d, 0.1));
        $users = round($sessions / (1.18 + 0.15 * $s->trait('return')));
        $engaged = round($sessions * (0.52 + 0.2 * $s->trait('engaged')) * $s->noise('engaged', $d, 0.04));
        $keyEvents = round($sessions * (0.012 + 0.025 * $s->trait('cvr')) * $s->noise('cvr', $d, 0.15));
        $ticket = (90 + 160 * $s->trait('ticket')) * $s->noise('ticket', $d, 0.1);

        return [
            'ga4:sessions' => $sessions,
            'ga4:total_users' => $users,
            'ga4:new_users' => round($users * (0.55 + 0.2 * $s->trait('new')) * $s->noise('new', $d, 0.05)),
            'ga4:engaged_sessions' => $engaged,
            'ga4:engagement_duration' => round($engaged * (70 + 60 * $s->trait('time')) * $s->noise('time', $d, 0.1)),
            'ga4:key_events' => $keyEvents,
            'ga4:purchase_revenue' => round($keyEvents * 0.6 * $ticket, 2),
        ];
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return $metricKey === 'ga4:total_users' ? UniqueAudience::of($daily, 0.3) : null;
    }
}
