<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string|null $display_name
 * @property string|null $primary_color
 * @property string|null $logo_path
 * @property bool $hide_delta_badge
 * @property string|null $email_reply_to
 * @property string|null $custom_domain
 * @property Carbon|null $domain_verified_at
 * @property string|null $updated_by
 * @property Carbon|null $updated_at
 */
#[Fillable(['display_name', 'primary_color', 'logo_path', 'hide_delta_badge', 'email_reply_to', 'custom_domain', 'domain_verified_at', 'updated_by'])]
class Branding extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['hide_delta_badge' => 'boolean', 'domain_verified_at' => 'datetime'];
    }
}
