<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * Registro de auditoria append-only. O banco revoga UPDATE/DELETE do delta_app;
 * o model também recusa, para o erro aparecer cedo e com mensagem clara.
 */
#[Fillable(['tenant_id', 'actor_user_id', 'action', 'subject_type', 'subject_id', 'ip', 'user_agent', 'metadata'])]
class AuditLog extends Model
{
    use HasUuids;

    public const UPDATED_AT = null;

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('audit_logs é append-only.'));
        static::deleting(fn () => throw new LogicException('audit_logs é append-only.'));
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['metadata' => 'array', 'created_at' => 'datetime'];
    }
}
