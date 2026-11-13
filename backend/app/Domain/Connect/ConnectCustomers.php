<?php

declare(strict_types=1);

namespace App\Domain\Connect;

use App\Models\ConnectCustomer;
use App\Models\ConnectSession;
use App\Models\Project;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Customers e sessões hospedadas do Delta Connect (ADR 0032). Tokens só aparecem na criação. */
final class ConnectCustomers
{
    public const SESSION_MINUTES = 30;

    /**
     * @param  array<string, mixed>  $metadata
     * @return array{0: ConnectCustomer, 1: string}
     */
    public function create(string $name, ?string $niche, ?string $externalId, array $metadata): array
    {
        return DB::transaction(function () use ($name, $niche, $externalId, $metadata): array {
            $project = Project::query()->create(['name' => $name, 'niche' => $niche]);
            $plain = self::token();
            $customer = ConnectCustomer::query()->create([
                'project_id' => $project->id,
                'external_id' => $externalId,
                'token_hash' => hash('sha256', $plain),
                'token_prefix' => substr($plain, 0, 12),
                'metadata' => $metadata,
            ]);

            return [$customer, $plain];
        });
    }

    public function rotate(ConnectCustomer $customer): string
    {
        $plain = self::token();
        $customer->forceFill(['token_hash' => hash('sha256', $plain), 'token_prefix' => substr($plain, 0, 12), 'revoked_at' => null])->save();

        return $plain;
    }

    /**
     * @param  list<string>  $platforms
     * @return array{0: ConnectSession, 1: string}
     */
    public function session(ConnectCustomer $customer, array $platforms, ?string $returnUrl): array
    {
        $plain = Str::random(48);
        $session = ConnectSession::query()->create([
            'customer_id' => $customer->id,
            'project_id' => $customer->project_id,
            'token_hash' => hash('sha256', $plain),
            'platforms' => array_values(array_unique($platforms)),
            'return_url' => $returnUrl,
            'expires_at' => now()->addMinutes(self::SESSION_MINUTES),
        ]);

        return [$session, $plain];
    }

    public static function sessionUrl(string $token): string
    {
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/')."/conectar/{$token}";
    }

    private static function token(): string
    {
        return 'dct_'.Str::random(40);
    }
}
