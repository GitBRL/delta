<?php

declare(strict_types=1);

namespace App\Models;

use App\Support\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Versão publicada de um relatório: os números ficam congelados. O banco só deixa a aplicação
 * atualizar o estado do PDF (privilégio por coluna).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $report_id
 * @property string $project_id
 * @property string $title
 * @property Carbon $period_start
 * @property Carbon $period_end
 * @property Carbon|null $compare_start
 * @property Carbon|null $compare_end
 * @property array<string, mixed> $data
 * @property 'pending'|'ready'|'failed' $pdf_status
 * @property string|null $pdf_path
 * @property string|null $pdf_error
 * @property string|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['report_id', 'project_id', 'title', 'period_start', 'period_end', 'compare_start', 'compare_end', 'data', 'pdf_status', 'pdf_path', 'pdf_error', 'created_by'])]
class ReportSnapshot extends Model
{
    use BelongsToTenant, HasUuids;

    /** @return BelongsTo<Report, $this> */
    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'data' => 'array',
            'period_start' => 'date',
            'period_end' => 'date',
            'compare_start' => 'date',
            'compare_end' => 'date',
        ];
    }
}
