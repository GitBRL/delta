<?php

declare(strict_types=1);

namespace App\Models;

use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * App OAuth de uma plataforma (Meta, Google) cadastrado pela agência.
 * A chave secreta e o developer token ficam criptografados e nunca voltam ao navegador.
 *
 * @property string $id
 * @property string $tenant_id
 * @property AppVendor $vendor
 * @property string $client_id
 * @property string $client_secret
 * @property string|null $developer_token
 * @property Carbon|null $verified_at
 * @property string|null $verification_error
 * @property string|null $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['vendor', 'client_id', 'client_secret', 'developer_token', 'verified_at', 'verification_error', 'updated_by'])]
#[Hidden(['client_secret', 'developer_token'])]
class OAuthApp extends Model
{
    use BelongsToTenant, HasUuids;

    protected $table = 'oauth_apps';

    /** @return 'verified'|'invalid'|'unverified' */
    public function verificationStatus(): string
    {
        return match (true) {
            $this->verification_error !== null => 'invalid',
            $this->verified_at !== null => 'verified',
            default => 'unverified',
        };
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'vendor' => AppVendor::class,
            'client_secret' => 'encrypted',
            'developer_token' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }
}
