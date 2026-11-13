<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Assinatura da agência (ADR 0031). "trial" usa os limites do plano de teste.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $plan
 * @property 'trialing'|'active'|'past_due'|'canceled' $status
 * @property Carbon|null $trial_ends_at
 * @property Carbon|null $current_period_ends_at
 * @property string $provider
 * @property string|null $provider_customer_id
 * @property string|null $provider_subscription_id
 * @property Carbon|null $canceled_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['plan', 'status', 'trial_ends_at', 'current_period_ends_at', 'provider', 'provider_customer_id', 'provider_subscription_id', 'canceled_at'])]
class Subscription extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['trial_ends_at' => 'datetime', 'current_period_ends_at' => 'datetime', 'canceled_at' => 'datetime'];
    }
}
