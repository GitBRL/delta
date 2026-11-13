<?php

declare(strict_types=1);

namespace App\Auth\Passkeys;

use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Laravel\Passkeys\Actions\VerifyPasskey;
use Laravel\Passkeys\Contracts\PasskeyUser;
use Laravel\Passkeys\Events\PasskeyVerified;
use Laravel\Passkeys\Exceptions\InvalidPasskeyException;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Passkeys;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Webauthn\Exception\WebauthnException;
use Webauthn\PublicKeyCredential;
use Webauthn\PublicKeyCredentialRequestOptions;

/**
 * Conferência de passkey compatível com RLS (ADR 0025).
 *
 * A credencial é achada por app.auth_passkey_by_credential (antes do login não há contexto), com
 * a linha travada até o fim da transação. O contexto do usuário só é definido depois que a
 * assinatura foi conferida; só então o contador e o último uso são gravados.
 */
class RlsVerifyPasskey extends VerifyPasskey
{
    public function __construct(private readonly TenantContext $context) {}

    public function __invoke(
        PublicKeyCredential $credential,
        PublicKeyCredentialRequestOptions $options,
        ?PasskeyUser $user = null,
    ): Passkey {
        $response = $this->getResponse($credential);

        /** @var Passkey */
        return DB::transaction(function () use ($credential, $options, $user, $response): Passkey {
            $passkey = $this->getPasskey($credential, lock: true);
            $this->ensurePasskeyBelongsToUser($passkey, $user);

            try {
                $source = $this->validate($response, $passkey, $options);
            } catch (WebauthnException) {
                // Assinatura inválida, contador que não avançou (clone ou repetição), origem errada...
                throw InvalidPasskeyException::make('Unable to verify passkey. Please try again.');
            }

            $userId = $passkey->getAttribute('user_id');
            $this->context->setUser(is_string($userId) ? $userId : null);

            $this->updatePasskey($passkey, $source);
            PasskeyVerified::dispatch($passkey->user, $passkey);

            return $passkey;
        });
    }

    public function getPasskey(PublicKeyCredential $credential, bool $lock = false): Passkey
    {
        $rows = DB::select('select * from app.auth_passkey_by_credential(?)', [Base64UrlSafe::encodeUnpadded($credential->rawId)]);
        if ($rows === []) {
            throw InvalidPasskeyException::make('Passkey não reconhecida. Ela pode ter sido removida da sua conta.');
        }

        /** @var class-string<Passkey> $model */
        $model = Passkeys::passkeyModel();
        /** @var array<string, mixed> $attributes */
        $attributes = (array) $rows[0];

        return (new $model)->newFromBuilder($attributes);
    }
}
