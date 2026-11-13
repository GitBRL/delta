<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Closure;

/**
 * Middleware de job: executa o job dentro do contexto do tenant (e do usuário, se houver)
 * capturado no momento do dispatch. Use com o trait TenantScopedJob.
 */
final readonly class TenantAware
{
    public function __construct(
        public string $tenantId,
        public ?string $userId = null,
    ) {}

    public function handle(object $job, Closure $next): mixed
    {
        return app(TenantContext::class)->run($this->tenantId, $this->userId, fn () => $next($job));
    }
}
