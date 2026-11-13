<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Contato do cliente final (quem recebe os relatórios). Opt-in por canal; o histórico fica em contact_consents.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string $name
 * @property string|null $email
 * @property string|null $phone
 * @property string|null $role
 * @property bool $email_opt_in
 * @property bool $whatsapp_opt_in
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'name', 'email', 'phone', 'role', 'email_opt_in', 'whatsapp_opt_in'])]
class Contact extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return HasMany<ContactConsent, $this> */
    public function consents(): HasMany
    {
        return $this->hasMany(ContactConsent::class);
    }

    public function canReceive(string $channel): bool
    {
        return match ($channel) {
            'email' => $this->email_opt_in && $this->email !== null && $this->email !== '',
            'whatsapp' => $this->whatsapp_opt_in && $this->phone !== null && $this->phone !== '',
            default => false,
        };
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['email_opt_in' => 'boolean', 'whatsapp_opt_in' => 'boolean'];
    }
}
