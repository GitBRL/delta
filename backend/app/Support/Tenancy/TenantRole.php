<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

/** Papel do usuário dentro de uma agência (tenant). Espelha o CHECK de tenant_user.role. */
enum TenantRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Analyst = 'analyst';
    case Client = 'client';

    public function label(): string
    {
        return match ($this) {
            self::Owner => 'Dono',
            self::Admin => 'Administrador',
            self::Analyst => 'Analista',
            self::Client => 'Cliente',
        };
    }

    /** Ordem de exibição na equipe (donos primeiro). */
    public function rank(): int
    {
        return match ($this) {
            self::Owner => 0,
            self::Admin => 1,
            self::Analyst => 2,
            self::Client => 3,
        };
    }

    public function isStaff(): bool
    {
        return $this !== self::Client;
    }

    public function canManageProjects(): bool
    {
        return in_array($this, [self::Owner, self::Admin, self::Analyst], true);
    }

    /** Configurações da agência (ex.: credenciais dos apps das plataformas). Espelha app.is_tenant_admin(). */
    public function canAdministerAgency(): bool
    {
        return $this === self::Owner || $this === self::Admin;
    }
}
