<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Post do Publishing (ADR 0028).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $project_id
 * @property string|null $title
 * @property string $caption
 * @property list<string> $media ids de media_assets, na ordem
 * @property 'draft'|'in_review'|'changes_requested'|'approved'|'scheduled'|'publishing'|'published'|'failed'|'cancelled' $status
 * @property bool $requires_approval
 * @property Carbon|null $scheduled_at
 * @property Carbon|null $published_at
 * @property string|null $external_reference
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project|null $project
 * @property-read Collection<int, PostTarget> $targets
 */
#[Fillable(['project_id', 'title', 'caption', 'media', 'requires_approval', 'scheduled_at', 'external_reference', 'created_by', 'updated_by'])]
class Post extends Model
{
    use BelongsToTenant, HasUuids;

    /** Estados em que o conteúdo ainda pode ser editado. */
    public const EDITABLE = ['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'failed'];

    protected $attributes = ['status' => 'draft', 'caption' => '', 'media' => '[]'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['media' => 'array', 'requires_approval' => 'boolean', 'scheduled_at' => 'datetime', 'published_at' => 'datetime'];
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return HasMany<PostTarget, $this> */
    public function targets(): HasMany
    {
        return $this->hasMany(PostTarget::class)->orderBy('created_at');
    }

    /** @return HasMany<PostApproval, $this> */
    public function approvals(): HasMany
    {
        return $this->hasMany(PostApproval::class);
    }
}
