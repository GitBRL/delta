<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Versão de uma apresentação: o que a IA propôs (spec), o layout validado e os números
 * calculados na hora da geração (rendered, mesmo formato do snapshot de relatório).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $presentation_id
 * @property int $number
 * @property string $instruction
 * @property array<string, mixed> $spec
 * @property array<string, mixed> $layout
 * @property array<string, mixed> $rendered
 * @property list<string> $unverified_numbers
 * @property string $model
 * @property int $input_tokens
 * @property int $output_tokens
 * @property string|null $created_by
 * @property Carbon|null $created_at
 */
#[Fillable(['presentation_id', 'number', 'instruction', 'spec', 'layout', 'rendered', 'unverified_numbers', 'model', 'input_tokens', 'output_tokens', 'created_by'])]
class PresentationVersion extends Model
{
    use BelongsToTenant, HasUuids;

    public const UPDATED_AT = null;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['spec' => 'array', 'layout' => 'array', 'rendered' => 'array', 'unverified_numbers' => 'array', 'number' => 'integer'];
    }
}
