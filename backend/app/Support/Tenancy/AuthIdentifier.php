<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Illuminate\Contracts\Auth\Authenticatable;
use LogicException;

/** Extrai o ID (UUID em string) de um usuário autenticado, com verificação de tipo. */
final class AuthIdentifier
{
    public static function of(Authenticatable $user): string
    {
        $id = $user->getAuthIdentifier();

        if (! is_string($id)) {
            throw new LogicException('Identificador de usuário inesperado: esperado UUID em string.');
        }

        return $id;
    }
}
