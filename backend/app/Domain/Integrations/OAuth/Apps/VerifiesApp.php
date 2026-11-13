<?php

declare(strict_types=1);

namespace App\Domain\Integrations\OAuth\Apps;

/** Login real que sabe conferir as credenciais do app com a plataforma, sem usuário envolvido. */
interface VerifiesApp
{
    public function verifyApp(AppCredentials $app): AppVerification;
}
