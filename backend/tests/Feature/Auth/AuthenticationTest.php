<?php

declare(strict_types=1);

use App\Models\AuditLog;
use Illuminate\Support\Facades\DB;

it('cadastra usuário, cria a agência e o torna dono', function () {
    $this->postJson('/auth/register', [
        'name' => 'Ana Souza',
        'email' => 'Ana@Exemplo.test',
        'password' => 'senha-muito-forte-123',
        'password_confirmation' => 'senha-muito-forte-123',
        'company_name' => 'Agência Aurora',
    ])->assertCreated();

    $me = $this->getJson('/api/me')->assertOk()->json('data');

    expect($me['email'])->toBe('ana@exemplo.test')
        ->and($me['two_factor_enabled'])->toBeFalse()
        ->and($me['tenants'])->toHaveCount(1)
        ->and($me['tenants'][0]['name'])->toBe('Agência Aurora')
        ->and($me['tenants'][0]['role'])->toBe('owner');

    security()->set($me['tenants'][0]['id'], $me['id']);
    expect(AuditLog::query()->where('action', 'tenant.created')->count())->toBe(1);
});

it('recusa cadastro com e-mail já usado em outra agência', function () {
    [, $existing] = tenantWithOwner();
    security()->clear();

    $this->postJson('/auth/register', [
        'name' => 'Outra Pessoa',
        'email' => strtoupper($existing->email),
        'password' => 'senha-muito-forte-123',
        'password_confirmation' => 'senha-muito-forte-123',
        'company_name' => 'Outra Agência',
    ])->assertUnprocessable()->assertJsonValidationErrors('email');
});

it('exige nome da empresa no cadastro', function () {
    $this->postJson('/auth/register', [
        'name' => 'Ana',
        'email' => 'ana@exemplo.test',
        'password' => 'senha-muito-forte-123',
        'password_confirmation' => 'senha-muito-forte-123',
    ])->assertUnprocessable()->assertJsonValidationErrors('company_name');
});

it('faz login sem contexto prévio, ignorando maiúsculas no e-mail', function () {
    [, $owner] = tenantWithOwner(password: 'senha-forte-123');
    security()->clear();

    $this->postJson('/auth/login', [
        'email' => strtoupper($owner->email),
        'password' => 'senha-forte-123',
    ])->assertOk()->assertJson(['two_factor' => false]);

    $this->getJson('/api/me')->assertOk()->assertJsonPath('data.id', $owner->id);
});

it('recusa senha errada', function () {
    [, $owner] = tenantWithOwner(password: 'senha-forte-123');
    security()->clear();

    $this->postJson('/auth/login', ['email' => $owner->email, 'password' => 'errada'])
        ->assertUnprocessable();

    $this->getJson('/api/me')->assertUnauthorized();
});

it('pede o segundo fator quando o 2FA está ativo', function () {
    [, $owner] = tenantWithOwner(password: 'senha-forte-123');
    security()->run(null, $owner->id, fn () => DB::table('users')->where('id', $owner->id)->update([
        'two_factor_secret' => encrypt('JBSWY3DPEHPK3PXP'),
        'two_factor_confirmed_at' => now(),
    ]));
    security()->clear();

    $this->postJson('/auth/login', ['email' => $owner->email, 'password' => 'senha-forte-123'])
        ->assertOk()->assertJson(['two_factor' => true]);

    $this->getJson('/api/me')->assertUnauthorized();
});

it('bloqueia a API sem autenticação', function () {
    $this->getJson('/api/me')->assertUnauthorized();
});
