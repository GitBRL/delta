<?php

declare(strict_types=1);

namespace App\Auth\Passkeys;

use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Laravel\Passkeys\Actions\StorePasskey;
use Laravel\Passkeys\Contracts\PasskeyUser;
use Laravel\Passkeys\Exceptions\InvalidPasskeyException;
use Laravel\Passkeys\Passkey;
use Webauthn\AuthenticatorAttestationResponse;
use Webauthn\CredentialRecord;
use Webauthn\Exception\WebauthnException;
use Webauthn\PublicKeyCredentialCreationOptions;

/**
 * Cadastro de passkey sob RLS (ADR 0025). A checagem de duplicidade do pacote só enxerga as
 * passkeys da própria pessoa; a de outra conta é barrada pelo índice único, num savepoint para
 * não abortar a transação. Atestado recusado vira mensagem de validação (não erro 500).
 */
class RlsStorePasskey extends StorePasskey
{
    protected function validate(AuthenticatorAttestationResponse $response, PublicKeyCredentialCreationOptions $options): CredentialRecord
    {
        try {
            return parent::validate($response, $options);
        } catch (WebauthnException) {
            throw InvalidPasskeyException::make('Unable to register passkey. Please try again.');
        }
    }

    public function createPasskey(PasskeyUser $user, string $name, CredentialRecord $source): Passkey
    {
        try {
            /** @var Passkey */
            return DB::transaction(fn (): Passkey => parent::createPasskey($user, $name, $source));
        } catch (UniqueConstraintViolationException) {
            throw InvalidPasskeyException::make('Não foi possível cadastrar esta passkey.');
        }
    }
}
