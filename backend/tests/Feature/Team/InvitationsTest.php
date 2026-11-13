<?php

declare(strict_types=1);

use App\Mail\InvitationMail;
use App\Models\AuditLog;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Mail::fake();
});

/** Convida e devolve [resposta, token]. */
function invite(array $body, $user = null): array
{
    $t = test();
    $response = $t->actingAs($user ?? $t->owner)->postJson('/api/team/invitations', $body, $t->headers);
    $url = (string) $response->json('invite_url');

    return [$response, $url === '' ? '' : substr($url, strrpos($url, '/') + 1)];
}

/** Vence os convites pelo relógio do banco (a validade é conferida lá, não no PHP). */
function expireInvitations(): void
{
    $t = test();
    security()->run($t->tenant->id, $t->owner->id, fn () => DB::table('invitations')->update(['expires_at' => DB::raw("now() - interval '1 minute'")]));
}

/** Simula outro navegador: sem a sessão de quem convidou. */
function anonymous(): void
{
    auth()->forgetGuards();
    security()->clear();
}

it('convida por e-mail: link de uso pessoal, só o hash no banco e e-mail na fila', function () {
    [$response, $token] = invite(['email' => 'Bia@Exemplo.test', 'role' => 'analyst']);

    $response->assertCreated()
        ->assertJsonPath('data.email', 'bia@exemplo.test')
        ->assertJsonPath('data.role', 'analyst')
        ->assertJsonPath('data.invited_by', $this->owner->name)
        ->assertJsonPath('data.expired', false);

    expect($response->json('invite_url'))->toBe('http://localhost:4300/convite/'.$token)
        ->and($token)->toMatch('/^[A-Za-z0-9]{48}$/')
        ->and(security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('invitations')->value('token_hash')))->toBe(hash('sha256', $token));

    Mail::assertQueued(InvitationMail::class, fn (InvitationMail $mail) => $mail->hasTo('bia@exemplo.test')
        && $mail->url === $response->json('invite_url')
        && $mail->tenantName === 'Agência Aurora'
        && $mail->roleLabel === 'Analista');

    $rendered = (new InvitationMail('Agência Aurora', 'Ana', 'Analista', [], 'http://x/convite/abc', '19/11/2026 às 10:00'))->render();
    expect($rendered)->toContain('Aceitar convite')->toContain('Agência Aurora');
});

it('mostra a prévia pública e cria a conta de quem ainda não tem uma, já dentro da agência', function () {
    [, $token] = invite(['email' => 'bia@exemplo.test', 'role' => 'analyst']);
    anonymous();

    $this->getJson("/api/invitations/{$token}")
        ->assertOk()
        ->assertJsonPath('data.tenant_name', 'Agência Aurora')
        ->assertJsonPath('data.role', 'analyst')
        ->assertJsonPath('data.inviter_name', $this->owner->name)
        ->assertJsonPath('data.status', 'pending')
        ->assertJsonPath('data.account_exists', false);

    $this->postJson("/api/invitations/{$token}/accept", ['name' => 'Bia'])
        ->assertUnprocessable()->assertJsonValidationErrors('password');

    $this->postJson("/api/invitations/{$token}/accept", ['name' => 'Bia', 'password' => 'senha-forte-123', 'password_confirmation' => 'senha-forte-123'])
        ->assertCreated()
        ->assertJsonPath('data.tenant_id', $this->tenant->id)
        ->assertJsonPath('data.tenant_name', 'Agência Aurora');

    $this->assertAuthenticated();
    $user = auth()->user();
    expect($user)->toBeInstanceOf(User::class)
        ->and($user->email)->toBe('bia@exemplo.test')
        ->and($user->email_verified_at)->not->toBeNull();

    $this->getJson('/api/me')->assertJsonPath('data.tenants.0.id', $this->tenant->id)->assertJsonPath('data.tenants.0.role', 'analyst');

    $this->getJson("/api/invitations/{$token}")->assertJsonPath('data.status', 'accepted');
    $this->postJson("/api/invitations/{$token}/accept")->assertStatus(410)->assertJsonPath('message', 'Este convite já foi aceito. Entre no Delta para acessar a agência.');

    security()->set($this->tenant->id, $this->owner->id);
    expect(AuditLog::query()->where('action', 'invitation.accepted')->sole()->actor_user_id)->toBe($user->id);
});

it('quem já tem conta entra e aceita; outra conta ou sem sessão não aceitam', function () {
    [, $otherOwner] = tenantWithOwner('Agência Boreal');
    [, $token] = invite(['email' => $otherOwner->email, 'role' => 'admin']);
    $stranger = addUserToTenant($this->tenant, TenantRole::Analyst);
    anonymous();

    $this->getJson("/api/invitations/{$token}")->assertJsonPath('data.account_exists', true);
    $this->postJson("/api/invitations/{$token}/accept", ['name' => 'X', 'password' => 'senha-forte-123', 'password_confirmation' => 'senha-forte-123'])
        ->assertStatus(409);

    $this->actingAs($stranger)->postJson("/api/invitations/{$token}/accept")
        ->assertForbidden()->assertJsonPath('message', "Este convite é para {$otherOwner->email}. Saia e entre com essa conta para aceitar.");

    $this->actingAs($otherOwner)->postJson("/api/invitations/{$token}/accept")
        ->assertOk()->assertJsonPath('data.tenant_id', $this->tenant->id);

    $fromDb = security()->run(null, $otherOwner->id, fn () => User::query()->findOrFail($otherOwner->id));
    $roles = collect($this->actingAs($fromDb)->getJson('/api/me')->json('data.tenants'))->pluck('role', 'name')->all();
    expect($roles)->toBe(['Agência Aurora' => 'admin', 'Agência Boreal' => 'owner']);
});

it('cliente convidado enxerga só os projetos escolhidos', function () {
    [$shared, $hidden] = asTenant($this->tenant, fn () => [
        Project::query()->create(['name' => 'Padaria Aurora']),
        Project::query()->create(['name' => 'Loja Secreta']),
    ]);
    security()->clear();

    invite(['email' => 'cliente@padaria.test', 'role' => 'client'])[0]
        ->assertUnprocessable()->assertJsonValidationErrors(['project_ids' => 'Escolha ao menos um projeto']);

    [$response, $token] = invite(['email' => 'cliente@padaria.test', 'role' => 'client', 'project_ids' => [$shared->id]]);
    $response->assertCreated()->assertJsonPath('data.projects', [['id' => $shared->id, 'name' => 'Padaria Aurora']]);
    anonymous();

    $this->postJson("/api/invitations/{$token}/accept", ['name' => 'Seu Zé', 'password' => 'senha-forte-123', 'password_confirmation' => 'senha-forte-123'])->assertCreated();

    $names = collect($this->getJson('/api/projects', $this->headers)->assertOk()->json('data'))->pluck('name')->all();
    expect($names)->toBe(['Padaria Aurora'])->not->toContain($hidden->name);
});

it('convite expirado, reenviado e revogado', function () {
    [, $token] = invite(['email' => 'bia@exemplo.test', 'role' => 'analyst']);
    expireInvitations();

    $this->getJson("/api/invitations/{$token}")->assertJsonPath('data.status', 'expired');
    anonymous();
    $this->postJson("/api/invitations/{$token}/accept", ['name' => 'Bia', 'password' => 'senha-forte-123', 'password_confirmation' => 'senha-forte-123'])
        ->assertStatus(410)->assertJsonPath('message', 'Este convite expirou. Peça um novo convite a quem convidou você.');
    expect(DB::scalar('select app.email_taken(?)', ['bia@exemplo.test']))->toBeFalse(); // a conta não ficou

    $id = security()->run($this->tenant->id, $this->owner->id, fn () => Invitation::query()->value('id'));
    security()->clear();
    $resent = $this->actingAs($this->owner)->postJson("/api/team/invitations/{$id}/resend", [], $this->headers)
        ->assertOk()->assertJsonPath('data.expired', false);
    $newToken = substr((string) $resent->json('invite_url'), -48);

    $this->getJson("/api/invitations/{$token}")->assertNotFound(); // o link antigo morreu
    $this->getJson("/api/invitations/{$newToken}")->assertJsonPath('data.status', 'pending');
    Mail::assertQueued(InvitationMail::class, 2);

    $this->actingAs($this->owner)->deleteJson("/api/team/invitations/{$id}", [], $this->headers)->assertNoContent();
    $this->getJson("/api/invitations/{$newToken}")->assertJsonPath('data.status', 'revoked');
    $this->getJson('/api/invitations/curto')->assertNotFound();
});

it('não duplica convite nem convida quem já está na equipe; convite vencido é substituído', function () {
    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();

    invite(['email' => strtoupper($analyst->email), 'role' => 'admin'])[0]
        ->assertUnprocessable()->assertJsonValidationErrors(['email' => 'já faz parte da equipe']);

    invite(['email' => 'bia@exemplo.test', 'role' => 'analyst'])[0]->assertCreated();
    invite(['email' => 'bia@exemplo.test', 'role' => 'admin'])[0]
        ->assertUnprocessable()->assertJsonValidationErrors(['email' => 'convite pendente']);

    expireInvitations();
    invite(['email' => 'bia@exemplo.test', 'role' => 'admin'])[0]->assertCreated()->assertJsonPath('data.role', 'admin');

    expect(security()->run($this->tenant->id, $this->owner->id, fn () => Invitation::query()->whereNull('revoked_at')->count()))->toBe(1);
});

it('só dono e administrador convidam e veem convites, inclusive no banco', function () {
    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    $admin = addUserToTenant($this->tenant, TenantRole::Admin);
    security()->clear();

    invite(['email' => 'bia@exemplo.test', 'role' => 'analyst'], $analyst)[0]->assertForbidden();
    $this->actingAs($analyst)->getJson('/api/team', $this->headers)->assertForbidden();
    invite(['email' => 'bia@exemplo.test', 'role' => 'admin'], $admin)[0]->assertCreated();

    security()->run($this->tenant->id, $analyst->id, function (): void {
        expect(DB::table('invitations')->count())->toBe(0)
            ->and(fn () => DB::transaction(fn () => DB::table('invitations')->insert([
                'email' => 'x@y.test', 'role' => 'admin', 'token_hash' => str_repeat('a', 64), 'expires_at' => now()->addDay(),
            ])))->toThrow(QueryException::class, 'row-level security');
    });
});

it('a função de aceite do banco recusa usuário com outro e-mail, mesmo chamada direto', function () {
    [, $token] = invite(['email' => 'bia@exemplo.test', 'role' => 'admin']);
    $intruder = addUserToTenant($this->tenant, TenantRole::Client);

    $result = security()->run(null, $intruder->id, fn () => DB::scalar('select app.accept_invitation(?)', [hash('sha256', $token)]));
    $membership = security()->run($this->tenant->id, $intruder->id, fn () => TenantMembership::query()
        ->where('tenant_id', $this->tenant->id)->where('user_id', $intruder->id)->sole());

    expect($result)->toBeNull()->and($membership->role)->toBe(TenantRole::Client);
});
