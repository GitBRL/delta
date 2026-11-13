<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use LogicException;

/** Erro de programação: um model de tenant foi criado sem contexto de tenant definido. */
final class MissingTenantContext extends LogicException
{
    public static function forModel(string $model): self
    {
        return new self("Tentativa de criar {$model} sem tenant no contexto de segurança.");
    }
}
