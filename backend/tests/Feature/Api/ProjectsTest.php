<?php

declare(strict_types=1);

use App\Models\AuditLog;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência A');
    [$this->otherTenant] = tenantWithOwner('Agência B');
    $this->foreignProject = asTenant($this->otherTenant, fn () => Project::query()->create(['name' => 'Projeto da B']));
    security()->clear();
});

function tenantHeader(string $tenantId): array
{
    return ['X-Tenant-Id' => $tenantId];
}

it('exige autenticação', function () {
    $this->getJson('/api/projects', tenantHeader($this->tenant->id))->assertUnauthorized();
});

it('exige o header X-Tenant-Id válido', function () {
    $this->actingAs($this->owner)->getJson('/api/projects')->assertStatus(400);
    $this->actingAs($this->owner)->getJson('/api/projects', ['X-Tenant-Id' => 'abc'])->assertStatus(400);
});

it('recusa agência da qual o usuário não é membro', function () {
    $this->actingAs($this->owner)
        ->getJson('/api/projects', tenantHeader($this->otherTenant->id))
        ->assertForbidden();
});

it('cria e lista só os projetos da própria agência', function () {
    $this->actingAs($this->owner)
        ->postJson('/api/projects', ['name' => 'Padaria Aurora', 'niche' => 'negocio_local'], tenantHeader($this->tenant->id))
        ->assertCreated()
        ->assertJsonPath('data.name', 'Padaria Aurora');

    $this->actingAs($this->owner)
        ->getJson('/api/projects', tenantHeader($this->tenant->id))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'Padaria Aurora');
});

it('registra a criação na auditoria', function () {
    $id = $this->actingAs($this->owner)
        ->postJson('/api/projects', ['name' => 'Loja Boreal'], tenantHeader($this->tenant->id))
        ->json('data.id');

    security()->set($this->tenant->id, $this->owner->id);
    $log = AuditLog::query()->where('action', 'project.created')->sole();

    expect($log->subject_id)->toBe($id)
        ->and($log->actor_user_id)->toBe($this->owner->id);
});

it('mostra projeto da própria agência (binding de rota com contexto já definido)', function () {
    $own = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Projeto da A']));
    security()->clear();

    $this->actingAs($this->owner)
        ->getJson("/api/projects/{$own->id}", tenantHeader($this->tenant->id))
        ->assertOk()
        ->assertJsonPath('data.name', 'Projeto da A');
});

it('responde 404 para projeto de outra agência, sem revelar que existe', function () {
    $this->actingAs($this->owner)
        ->getJson("/api/projects/{$this->foreignProject->id}", tenantHeader($this->tenant->id))
        ->assertNotFound();
});

it('valida os dados do projeto', function () {
    $this->actingAs($this->owner)
        ->postJson('/api/projects', ['name' => ''], tenantHeader($this->tenant->id))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');
});

it('não deixa o papel cliente criar projetos', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    $this->actingAs($client)
        ->postJson('/api/projects', ['name' => 'Tentativa'], tenantHeader($this->tenant->id))
        ->assertForbidden();
});
