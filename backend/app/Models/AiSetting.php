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
 * @property string $id
 * @property string $tenant_id
 * @property string|null $api_key
 * @property bool $enabled
 * @property int $monthly_token_budget
 * @property string|null $updated_by
 * @property Carbon|null $updated_at
 */
#[Fillable(['api_key', 'enabled', 'monthly_token_budget', 'updated_by'])]
#[Hidden(['api_key'])]
class AiSetting extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['api_key' => 'encrypted', 'enabled' => 'boolean', 'monthly_token_budget' => 'integer'];
    }
}
