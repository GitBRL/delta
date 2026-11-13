<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Segunda camada de isolamento (a primeira é o RLS no banco).
 * Sem tenant no contexto, a consulta não retorna nada (fail-closed também no código).
 *
 * @implements Scope<Model>
 */
final class TenantScope implements Scope
{
    /** @param Builder<covariant Model> $builder */
    public function apply(Builder $builder, Model $model): void
    {
        $tenantId = app(TenantContext::class)->tenantId();

        if ($tenantId === null) {
            $builder->whereRaw('false');

            return;
        }

        $builder->where($model->qualifyColumn('tenant_id'), $tenantId);
    }
}
