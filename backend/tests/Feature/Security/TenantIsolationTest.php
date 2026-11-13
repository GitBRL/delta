<?php

declare(strict_types=1);

use App\Models\AuditLog;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
| Isolamento no BANCO. As consultas usam DB::table() de propósito: o query builder cru não tem
| o TenantScope do Eloquent, então o que está sendo provado aqui é a política de RLS.
*/

beforeEach(function () {
    [$this->tenantA, $this->ownerA] = tenantWithOwner('Agência A');
    [$this->tenantB, $this->ownerB] = tenantWithOwner('Agência B');

    $this->projectA = asTenant($this->tenantA, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    asTenant($this->tenantB, fn () => Project::query()->create(['name' => 'Loja Boreal']));

    security()->clear();
});

it('não mostra nada sem contexto (fail-closed)', function () {
    expect(DB::table('projects')->count())->toBe(0)
        ->and(DB::table('tenants')->count())->toBe(0)
        ->and(DB::table('users')->count())->toBe(0)
        ->and(DB::table('tenant_user')->count())->toBe(0)
        ->and(Project::query()->count())->toBe(0);
});

it('mostra a cada agência só os próprios projetos', function () {
    security()->set($this->tenantB->id, $this->ownerB->id);

    expect(DB::table('projects')->pluck('name')->all())->toBe(['Loja Boreal'])
        ->and(DB::table('projects')->where('id', $this->projectA->id)->exists())->toBeFalse();
});

it('não deixa uma agência alterar ou apagar dados de outra', function () {
    security()->set($this->tenantB->id, $this->ownerB->id);

    $updated = DB::table('projects')->where('id', $this->projectA->id)->update(['name' => 'invadido']);
    $deleted = DB::table('projects')->where('id', $this->projectA->id)->delete();

    expect($updated)->toBe(0)->and($deleted)->toBe(0);

    security()->set($this->tenantA->id, $this->ownerA->id);
    expect(DB::table('projects')->where('id', $this->projectA->id)->value('name'))->toBe('Padaria Aurora');
});

it('recusa inserir linha com tenant_id de outra agência', function () {
    security()->set($this->tenantB->id, $this->ownerB->id);

    expect(fn () => DB::transaction(fn () => DB::table('projects')->insert([
        'tenant_id' => $this->tenantA->id,
        'name' => 'Projeto plantado',
    ])))->toThrow(QueryException::class, 'row-level security');
});

it('preenche tenant_id pelo contexto quando omitido', function () {
    security()->set($this->tenantA->id, $this->ownerA->id);

    DB::table('projects')->insert(['name' => 'Sem tenant explícito']);

    expect(DB::table('projects')->where('name', 'Sem tenant explícito')->value('tenant_id'))->toBe($this->tenantA->id);
});

it('esconde usuários e agências de quem não é colega', function () {
    security()->set($this->tenantB->id, $this->ownerB->id);

    expect(DB::table('users')->where('id', $this->ownerA->id)->exists())->toBeFalse()
        ->and(DB::table('tenants')->where('id', $this->tenantA->id)->exists())->toBeFalse()
        ->and(DB::table('users')->where('id', $this->ownerB->id)->exists())->toBeTrue();
});

it('limita o papel cliente aos projetos dos quais é membro', function () {
    $client = addUserToTenant($this->tenantA, TenantRole::Client);
    $other = asTenant($this->tenantA, fn () => Project::query()->create(['name' => 'Outro cliente']));
    asTenant($this->tenantA, fn () => ProjectMember::query()->create([
        'project_id' => $this->projectA->id,
        'user_id' => $client->id,
    ]));

    security()->set($this->tenantA->id, $client->id);

    expect(DB::table('projects')->pluck('id')->all())->toBe([$this->projectA->id])
        ->and(DB::table('projects')->where('id', $other->id)->exists())->toBeFalse();
});

it('não deixa o papel cliente criar projetos', function () {
    $client = addUserToTenant($this->tenantA, TenantRole::Client);
    security()->set($this->tenantA->id, $client->id);

    expect(fn () => DB::transaction(fn () => DB::table('projects')->insert(['name' => 'Projeto do cliente'])))
        ->toThrow(QueryException::class, 'row-level security');
});

it('mantém audit_logs append-only para a aplicação', function () {
    security()->set($this->tenantA->id, $this->ownerA->id);
    $log = AuditLog::query()->create(['action' => 'teste']);

    expect(fn () => DB::transaction(fn () => DB::table('audit_logs')->where('id', $log->id)->update(['action' => 'adulterado'])))
        ->toThrow(QueryException::class, 'permission denied')
        ->and(fn () => DB::transaction(fn () => DB::table('audit_logs')->where('id', $log->id)->delete()))
        ->toThrow(QueryException::class, 'permission denied');
});

it('não mostra auditoria de outra agência', function () {
    asTenant($this->tenantA, fn () => AuditLog::query()->create(['action' => 'segredo.a']));
    security()->set($this->tenantB->id, $this->ownerB->id);

    expect(DB::table('audit_logs')->where('action', 'segredo.a')->exists())->toBeFalse();
});
