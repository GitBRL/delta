<?php

declare(strict_types=1);

use App\Models\User;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;
use Laravel\Passkeys\Actions\GenerateVerificationOptions;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Support\WebAuthn;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Symfony\Component\Uid\Uuid;
use Webauthn\CredentialRecord;
use Webauthn\TrustPath\EmptyTrustPath;

/*
| Passkeys sob RLS (ADR 0025). As cerimônias WebAuthn são montadas de verdade no teste:
| chave P-256, dados do autenticador, clientDataJSON e assinatura ECDSA, como faria o navegador.
*/

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    security()->clear();
    $this->key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $this->credentialId = random_bytes(16);
});

function b64u(string $bytes): string
{
    return Base64UrlSafe::encodeUnpadded($bytes);
}

/** Chave pública no formato COSE (EC2, P-256, ES256), em CBOR. */
function coseKey(OpenSSLAsymmetricKey $key): string
{
    $ec = openssl_pkey_get_details($key)['ec'];
    $pad = fn (string $v) => str_pad($v, 32, "\0", STR_PAD_LEFT);

    return "\xa5\x01\x02\x03\x26\x20\x01\x21\x58\x20".$pad($ec['x'])."\x22\x58\x20".$pad($ec['y']);
}

function rpIdHash(): string
{
    return hash('sha256', (string) config('passkeys.relying_party_id'), true);
}

function origin(): string
{
    return (string) config('passkeys.allowed_origins')[0];
}

/** Grava uma passkey já cadastrada (como se a pessoa tivesse registrado antes). */
function storedPasskey(User $user, string $credentialId, OpenSSLAsymmetricKey $key, int $counter = 0): Passkey
{
    $record = CredentialRecord::create($credentialId, 'public-key', ['internal'], 'none', EmptyTrustPath::create(),
        Uuid::fromString('00000000-0000-0000-0000-000000000000'), coseKey($key), $user->getPasskeyUserHandle(), $counter);

    $passkey = security()->run(null, $user->id, fn () => $user->passkeys()->create([
        'name' => 'MacBook', 'credential_id' => b64u($credentialId), 'credential' => json_decode(WebAuthn::toJson($record), true),
    ]));
    security()->clear();

    return $passkey;
}

/** Resposta de login ("webauthn.get") assinada com a chave do autenticador. */
function assertion(string $challenge, string $credentialId, OpenSSLAsymmetricKey $key, int $counter, User $user): array
{
    $clientData = json_encode(['type' => 'webauthn.get', 'challenge' => b64u($challenge), 'origin' => origin(), 'crossOrigin' => false]);
    $authData = rpIdHash()."\x05".pack('N', $counter); // UP + UV
    openssl_sign($authData.hash('sha256', $clientData, true), $signature, $key, OPENSSL_ALGO_SHA256);

    return ['id' => b64u($credentialId), 'rawId' => b64u($credentialId), 'type' => 'public-key', 'response' => [
        'clientDataJSON' => b64u($clientData), 'authenticatorData' => b64u($authData), 'signature' => b64u($signature), 'userHandle' => b64u($user->getPasskeyUserHandle()),
    ]];
}

/** Opções de login guardadas na sessão, como faz GET /auth/passkeys/login/options. */
function loginChallenge(): string
{
    $options = app(GenerateVerificationOptions::class)();
    session()->put('passkey.verification_options', WebAuthn::toJson($options));

    return $options->challenge;
}

function passkeyRow(User $user): ?object
{
    $row = security()->run(null, $user->id, fn () => DB::table('passkeys')->where('user_id', $user->id)->first());
    security()->clear();

    return $row;
}

it('cadastra uma passkey com atestado "none" e a deixa visível só para a própria pessoa', function () {
    $options = $this->actingAs($this->owner)->withSession(['auth.password_confirmed_at' => time()])
        ->getJson('/auth/user/passkeys/options')->assertOk()->json('options');

    expect($options['rp']['id'])->toBe(config('passkeys.relying_party_id'))
        ->and($options['authenticatorSelection']['userVerification'] ?? null)->toBe('required');

    $clientData = json_encode(['type' => 'webauthn.create', 'challenge' => $options['challenge'], 'origin' => origin(), 'crossOrigin' => false]);
    $authData = rpIdHash()."\x45".pack('N', 0).str_repeat("\0", 16).pack('n', 16).$this->credentialId.coseKey($this->key); // UP + UV + AT
    $attestation = "\xa3\x63fmt\x64none\x67attStmt\xa0\x68authData\x58".chr(strlen($authData)).$authData;

    $this->actingAs($this->owner)->postJson('/auth/user/passkeys', ['name' => 'MacBook da Ana', 'credential' => [
        'id' => b64u($this->credentialId), 'rawId' => b64u($this->credentialId), 'type' => 'public-key',
        'response' => ['clientDataJSON' => b64u($clientData), 'attestationObject' => b64u($attestation), 'transports' => ['internal']],
    ]])->assertSuccessful();

    expect(passkeyRow($this->owner)?->name)->toBe('MacBook da Ana');

    // Outra pessoa, mesmo da mesma agência, não enxerga a passkey (RLS).
    $colleague = addUserToTenant($this->tenant, TenantRole::Analyst);
    expect(security()->run($this->tenant->id, $colleague->id, fn () => DB::table('passkeys')->count()))->toBe(0)
        ->and(security()->run(null, null, fn () => DB::table('passkeys')->count()))->toBe(0);
});

it('entra com a passkey antes de existir contexto e avança o contador', function () {
    storedPasskey($this->owner, $this->credentialId, $this->key);

    $this->getJson('/auth/passkeys/login/options')->assertOk()->assertJsonPath('options.userVerification', 'required');

    $challenge = loginChallenge();
    $this->postJson('/auth/passkeys/login', ['credential' => assertion($challenge, $this->credentialId, $this->key, 1, $this->owner)])
        ->assertOk()->assertJsonStructure(['redirect']);

    $this->assertAuthenticatedAs($this->owner);
    $row = passkeyRow($this->owner);
    expect(json_decode($row->credential, true)['counter'])->toBe(1)->and($row->last_used_at)->not->toBeNull();
});

it('recusa assinatura repetida (contador que não avançou) e chave errada', function () {
    storedPasskey($this->owner, $this->credentialId, $this->key, counter: 7);

    $this->postJson('/auth/passkeys/login', ['credential' => assertion(loginChallenge(), $this->credentialId, $this->key, 7, $this->owner)])
        ->assertUnprocessable();
    $this->assertGuest();

    $intruder = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $this->postJson('/auth/passkeys/login', ['credential' => assertion(loginChallenge(), $this->credentialId, $intruder, 8, $this->owner)])
        ->assertUnprocessable();
    $this->assertGuest();

    expect(json_decode(passkeyRow($this->owner)->credential, true)['counter'])->toBe(7);
});

it('explica em português quando a passkey não existe', function () {
    $this->postJson('/auth/passkeys/login', ['credential' => assertion(loginChallenge(), random_bytes(16), $this->key, 1, $this->owner)])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['credential' => 'Passkey não reconhecida']);
    $this->assertGuest();
});

it('só a própria pessoa remove a passkey, e com a senha confirmada', function () {
    $passkey = storedPasskey($this->owner, $this->credentialId, $this->key);
    $colleague = addUserToTenant($this->tenant, TenantRole::Admin);

    $this->actingAs($colleague)->withSession(['auth.password_confirmed_at' => time()])
        ->deleteJson("/auth/user/passkeys/{$passkey->id}")->assertNotFound();
    expect(passkeyRow($this->owner))->not->toBeNull();

    $this->actingAs($this->owner)->withSession(['auth.password_confirmed_at' => 0])
        ->deleteJson("/auth/user/passkeys/{$passkey->id}")->assertStatus(423);

    $this->actingAs($this->owner)->withSession(['auth.password_confirmed_at' => time()])
        ->deleteJson("/auth/user/passkeys/{$passkey->id}")->assertSuccessful();
    expect(passkeyRow($this->owner))->toBeNull();
});

it('lista só as passkeys da própria pessoa, sem dados da credencial', function () {
    storedPasskey($this->owner, $this->credentialId, $this->key);
    $colleague = addUserToTenant($this->tenant, TenantRole::Analyst);

    $this->actingAs($this->owner)->getJson('/api/me/passkeys')->assertOk()
        ->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'MacBook')
        ->assertJsonMissingPath('data.0.credential')->assertJsonMissingPath('data.0.credential_id');
    $this->actingAs($colleague)->getJson('/api/me/passkeys')->assertOk()->assertJsonCount(0, 'data');
});
