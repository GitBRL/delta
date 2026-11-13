<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Mídia da biblioteca do Publishing (ADR 0028). Imagens recodificadas em JPEG; vídeos como vieram.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string|null $project_id
 * @property 'image'|'video' $kind
 * @property string $path
 * @property string $original_name
 * @property string $mime
 * @property int $size_bytes
 * @property int|null $width
 * @property int|null $height
 * @property string $checksum
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['project_id', 'kind', 'path', 'original_name', 'mime', 'size_bytes', 'width', 'height', 'checksum', 'created_by'])]
class MediaAsset extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['size_bytes' => 'integer', 'width' => 'integer', 'height' => 'integer'];
    }
}
