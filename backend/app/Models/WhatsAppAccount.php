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
 * Número de WhatsApp da agência: demonstração (sandbox) ou Cloud API oficial da Meta.
 * Tokens e segredos criptografados; nunca voltam ao navegador.
 *
 * @property string $id
 * @property string $tenant_id
 * @property 'sandbox'|'cloud' $mode
 * @property string|null $phone_number_id
 * @property string|null $waba_id
 * @property string|null $display_phone
 * @property string|null $access_token
 * @property string|null $app_secret
 * @property string|null $verify_token
 * @property string|null $verify_token_hash
 * @property string|null $template_name
 * @property string $template_language
 * @property Carbon|null $verified_at
 * @property string|null $verification_error
 * @property string|null $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['mode', 'phone_number_id', 'waba_id', 'display_phone', 'access_token', 'app_secret', 'verify_token', 'verify_token_hash', 'template_name', 'template_language', 'verified_at', 'verification_error', 'updated_by'])]
#[Hidden(['access_token', 'app_secret', 'verify_token', 'verify_token_hash'])]
class WhatsAppAccount extends Model
{
    use BelongsToTenant, HasUuids;

    protected $table = 'whatsapp_accounts';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'access_token' => 'encrypted',
            'app_secret' => 'encrypted',
            'verify_token' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }
}
