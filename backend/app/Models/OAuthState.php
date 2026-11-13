<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Fluxo de login OAuth em andamento (uso único, expira em minutos).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string|null $user_id
 * @property string|null $connect_session_id
 * @property string $provider
 * @property 'sandbox'|'live' $mode
 * @property string $flow
 * @property 'popup'|'redirect' $return_mode
 * @property string $state_hash
 * @property string|null $code_verifier
 * @property string $redirect_uri
 * @property Carbon $expires_at
 * @property Carbon|null $used_at
 */
#[Fillable(['user_id', 'provider', 'mode', 'flow', 'return_mode', 'state_hash', 'code_verifier', 'redirect_uri', 'expires_at', 'used_at', 'connect_session_id'])]
class OAuthState extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    protected $table = 'oauth_states';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'code_verifier' => 'encrypted',
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }
}
