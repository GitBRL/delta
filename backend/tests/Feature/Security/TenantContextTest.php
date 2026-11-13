<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function sessionContext(): array
{
    $row = DB::selectOne("SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('app.user_id', true) AS usr");

    return [$row->tenant ?: null, $row->usr ?: null];
}

it('espelha o contexto nas variáveis de sessão do Postgres', function () {
    $tenant = (string) Str::uuid7();
    $user = (string) Str::uuid7();

    security()->set($tenant, $user);
    expect(sessionContext())->toBe([$tenant, $user]);

    security()->clear();
    expect(sessionContext())->toBe([null, null]);
});

it('restaura o contexto anterior depois de run(), mesmo com exceção', function () {
    $outer = (string) Str::uuid7();
    security()->set($outer, null);

    try {
        security()->run((string) Str::uuid7(), null, fn () => throw new RuntimeException('falhou'));
    } catch (RuntimeException) {
    }

    expect(sessionContext())->toBe([$outer, null])
        ->and(security()->tenantId())->toBe($outer);
});

it('recusa identificadores que não são UUID', function () {
    security()->setTenant("x' OR '1'='1");
})->throws(InvalidArgumentException::class);

it('limpa o contexto entre requests, mesmo no mesmo processo', function () {
    [$tenant, $owner] = tenantWithOwner();

    $this->actingAs($owner)
        ->getJson('/api/projects', ['X-Tenant-Id' => $tenant->id])
        ->assertOk();

    expect(sessionContext())->toBe([null, null]);
});
