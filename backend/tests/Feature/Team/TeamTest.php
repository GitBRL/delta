<?php

declare(strict_types=1);

use App\Models\AuditLog;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Mail;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->admin = addUserToTenant($this->tenant, TenantRole::Admin);
    $this->analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Mail::fake();
});

function patchMember($actor, $target, array $body)
{
    $t = test();

    return $t->actingAs($actor)->patchJson("/api/team/members/{$target->id}", $body, $t->headers);
}

it('lista a equipe com donos primeiro, quem é você e convites pendentes', function () {
    $this->actingAs($this->owner)->postJson('/api/team/invitations', ['email' => 'bia@exemplo.test', 'role' => 'analyst'], $this->headers)->assertCreated();

    $team = $this->actingAs($this->admin)->getJson('/api/team', $this->headers)->assertOk()->json('data');

    expect(array_column($team['members'], 'role'))->toBe(['owner', 'admin', 'analyst'])
        ->and(array_column($team['members'], 'is_you'))->toBe([false, true, false])
        ->and($team['invitations'][0]['email'])->toBe('bia@exemplo.test')
        ->and($team['can_manage_owners'])->toBeFalse();

    $this->actingAs($this->owner)->getJson('/api/team', $this->headers)->assertJsonPath('data.can_manage_owners', true);
});

it('muda papéis com auditoria; cliente precisa de projeto', function () {
    $project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    security()->clear();

    patchMember($this->admin, $this->analyst, ['role' => 'admin'])->assertOk()->assertJsonPath('data.role', 'admin');
    patchMember($this->admin, $this->analyst, ['role' => 'client'])->assertUnprocessable()->assertJsonValidationErrors('project_ids');
    patchMember($this->admin, $this->analyst, ['role' => 'client', 'project_ids' => [$project->id]])
        ->assertOk()
        ->assertJsonPath('data.role', 'client')
        ->assertJsonPath('data.projects', [['id' => $project->id, 'name' => 'Padaria Aurora']]);

    security()->set($this->tenant->id, $this->owner->id);
    expect(AuditLog::query()->where('action', 'member.role_changed')->count())->toBe(2);
});

it('só dono mexe em dono e a agência nunca fica sem dono', function () {
    patchMember($this->admin, $this->analyst, ['role' => 'owner'])->assertForbidden();
    patchMember($this->admin, $this->owner, ['role' => 'analyst'])->assertForbidden();
    $this->actingAs($this->admin)->deleteJson("/api/team/members/{$this->owner->id}", [], $this->headers)->assertForbidden();

    patchMember($this->owner, $this->owner, ['role' => 'admin'])
        ->assertUnprocessable()->assertJsonValidationErrors(['role' => 'pelo menos um dono']);

    patchMember($this->owner, $this->admin, ['role' => 'owner'])->assertOk();
    patchMember($this->owner, $this->owner, ['role' => 'admin'])->assertOk(); // agora há outro dono
});

it('remove membro, que perde o acesso na hora; ninguém remove a si mesmo', function () {
    $this->actingAs($this->admin)->deleteJson("/api/team/members/{$this->admin->id}", [], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['member' => 'a si mesmo']);

    $this->actingAs($this->admin)->deleteJson("/api/team/members/{$this->analyst->id}", [], $this->headers)->assertNoContent();
    $this->actingAs($this->admin)->deleteJson("/api/team/members/{$this->analyst->id}", [], $this->headers)->assertNotFound();

    $this->actingAs($this->analyst)->getJson('/api/projects', $this->headers)->assertForbidden();
});

it('analista e cliente não gerenciam a equipe', function () {
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    foreach ([$this->analyst, $client] as $user) {
        $this->actingAs($user)->getJson('/api/team', $this->headers)->assertForbidden();
        patchMember($user, $this->admin, ['role' => 'analyst'])->assertForbidden();
    }
});

it('lista a equipe enxuta para escolher responsáveis, sem o cliente', function () {
    addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();

    $names = array_column($this->actingAs($this->analyst)->getJson('/api/staff-members', $this->headers)->assertOk()->json('data'), 'name');
    expect($names)->toHaveCount(3)->not->toContain('Usuário client');
});
