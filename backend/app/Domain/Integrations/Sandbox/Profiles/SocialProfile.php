<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox\Profiles;

use App\Domain\Integrations\Sandbox\SandboxProfile;
use App\Domain\Integrations\Sandbox\Season;
use App\Domain\Integrations\Sandbox\Seed;
use Carbon\CarbonImmutable;

/**
 * Perfil orgânico (Instagram e página do Facebook). Seguidores crescem em curva exponencial
 * suave calculada em forma fechada, para qualquer dia sair do mesmo valor sem acumular estado.
 */
final readonly class SocialProfile implements SandboxProfile
{
    private function __construct(
        private string $provider,
        private string $engagementKey,
        private string $name,
        private float $engagementBase,
        private bool $hasFollows,
    ) {}

    public static function instagram(): self
    {
        return new self('instagram', 'instagram:interactions', 'Perfil do Instagram (demonstração)', 0.025, true);
    }

    public static function facebook(): self
    {
        return new self('facebook', 'facebook:engagements', 'Página do Facebook (demonstração)', 0.012, false);
    }

    public function accountName(): string
    {
        return $this->name;
    }

    public function currency(): ?string
    {
        return null;
    }

    public function day(Seed $s, CarbonImmutable $d): array
    {
        $p = $this->provider;
        $base = 3000 + 40000 * $s->trait('followers');
        $rate = 0.0004 + 0.0012 * $s->trait('growth');
        $dayIndex = CarbonImmutable::parse('2024-01-01')->diffInDays($d);
        $followers = $base * exp($rate * $dayIndex);

        $posts = ($s->daily('post', $d) < 0.55 ? 1 : 0) + ($s->daily('post2', $d) < 0.12 ? 1 : 0);
        $views = round($followers * (0.12 + 0.1 * $s->trait('views')) * (1 + 0.9 * $posts) * Season::factor($d, 'social') * $s->noise('views', $d, 0.2));
        $reach = round($views / (1.5 + 0.4 * $s->trait('repeat')));
        $engagement = round($reach * ($this->engagementBase + 0.035 * $s->trait('engagement')) * $s->noise('engagement', $d, 0.2));

        $values = [
            "{$p}:followers" => round($followers),
            "{$p}:views" => $views,
            "{$p}:reach" => $reach,
            $this->engagementKey => $engagement,
            "{$p}:posts" => (float) $posts,
        ];

        if ($this->hasFollows) {
            $values["{$p}:follows"] = round($followers * $rate * 1.6 * $s->noise('follows', $d, 0.3));
        }

        return $values;
    }

    public function period(string $metricKey, array $daily): ?float
    {
        return $metricKey === "{$this->provider}:reach" ? UniqueAudience::of($daily, 0.45) : null;
    }
}
