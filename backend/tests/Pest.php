<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Models\IntegrationConnection;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

pest()->extend(TestCase::class)->in('Feature');

/*
| Helpers. Criar dados sob RLS exige contexto: cada helper roda dentro de TenantContext::run()
| com os IDs gerados antes do INSERT, exatamente como o cadastro real faz.
*/

function security(): TenantContext
{
    return app(TenantContext::class);
}

/** @return array{0: Tenant, 1: User} */
function tenantWithOwner(string $company = 'Agência Teste', string $password = 'senha-forte-123'): array
{
    $tenantId = (string) Str::uuid7();
    $userId = (string) Str::uuid7();

    return security()->run($tenantId, $userId, function () use ($tenantId, $userId, $company, $password): array {
        $user = new User([
            'name' => 'Dono '.$company,
            'email' => Str::lower(Str::random(10)).'@example.test',
            'password' => Hash::make($password),
        ]);
        $user->id = $userId;
        $user->save();

        $tenant = Tenant::query()->create([
            'id' => $tenantId,
            'name' => $company,
            'slug' => Str::slug($company).'-'.Str::lower(Str::random(6)),
        ]);

        TenantMembership::query()->create([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'role' => TenantRole::Owner,
        ]);

        return [$tenant, $user];
    });
}

function addUserToTenant(Tenant $tenant, TenantRole $role): User
{
    $userId = (string) Str::uuid7();

    return security()->run($tenant->id, $userId, function () use ($tenant, $userId, $role): User {
        $user = new User([
            'name' => 'Usuário '.$role->value,
            'email' => Str::lower(Str::random(10)).'@example.test',
            'password' => Hash::make('senha-forte-123'),
        ]);
        $user->id = $userId;
        $user->save();

        TenantMembership::query()->create([
            'tenant_id' => $tenant->id,
            'user_id' => $userId,
            'role' => $role,
        ]);

        return $user;
    });
}

/** Executa como sistema dentro do tenant (sem usuário), útil para preparar dados. */
function asTenant(Tenant $tenant, Closure $callback): mixed
{
    return security()->run($tenant->id, null, $callback);
}

/** Conecta uma conta de demonstração (o backfill roda na hora: fila "sync" nos testes). */
function connectSandbox(Tenant $tenant, User $user, string $provider = 'meta_ads'): IntegrationConnection
{
    return security()->run($tenant->id, $user->id, fn (): IntegrationConnection => app(ConnectionManager::class)
        ->connectSandbox($provider, $user->id)
        ->load('accounts'));
}
