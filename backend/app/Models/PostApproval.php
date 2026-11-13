<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Pedido de aprovação de um post pelo cliente (link público). O token fica cifrado (para a
 * equipe copiar o link de novo) e o hash serve à busca sem contexto (ADR 0028).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $post_id
 * @property string $token_hash
 * @property string $token
 * @property string|null $requested_by
 * @property Carbon $expires_at
 * @property Carbon|null $decided_at
 * @property 'approved'|'changes_requested'|null $decision
 * @property string|null $comment
 * @property string|null $decided_by_name
 * @property array<string, int> $notified
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['post_id', 'token_hash', 'token', 'requested_by', 'expires_at', 'notified'])]
#[Hidden(['token', 'token_hash'])]
class PostApproval extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['token' => 'encrypted', 'expires_at' => 'datetime', 'decided_at' => 'datetime', 'notified' => 'array'];
    }
}
