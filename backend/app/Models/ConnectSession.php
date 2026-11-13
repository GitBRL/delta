<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Sessão hospedada de conexão do Delta Connect (ADR 0032): link curto em que o cliente final
 * conecta as contas do projeto, sem login no Delta.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $customer_id
 * @property string $project_id
 * @property string $token_hash
 * @property list<string> $platforms
 * @property string|null $return_url
 * @property Carbon $expires_at
 * @property list<string> $connected ids das conexões criadas
 */
#[Fillable(['customer_id', 'project_id', 'token_hash', 'platforms', 'return_url', 'expires_at', 'connected'])]
class ConnectSession extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['platforms' => 'array', 'connected' => 'array', 'expires_at' => 'datetime'];
    }
}
