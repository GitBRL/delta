<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

/**
 * Para jobs que operam dados de um tenant. Chame captureTenantContext() no construtor;
 * o tenant (e o usuário) do momento do dispatch serão restaurados quando o job rodar.
 */
trait TenantScopedJob
{
    public ?string $tenantId = null;

    public ?string $actingUserId = null;

    protected function captureTenantContext(): void
    {
        $context = app(TenantContext::class);

        $this->tenantId = $context->tenantId() ?? throw MissingTenantContext::forModel(static::class);
        $this->actingUserId = $context->userId();
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [new TenantAware((string) $this->tenantId, $this->actingUserId)];
    }
}
