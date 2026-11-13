<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Importer\ReporteiClient;
use App\Domain\Timeline\Timeline;
use App\Models\Import;
use App\Models\Project;
use App\Support\Tenancy\TenantScopedJob;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Importa do Reportei: projetos, marcos da linha do tempo e a lista de integrações para
 * reconectar no Delta. O token vai criptografado no payload da fila e não é gravado em lugar
 * nenhum. Idempotente por nome de projeto (rodar de novo não duplica). ADR 0022.
 */
final class ImportFromReportei implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        public readonly string $importId,
        public readonly string $token,
    ) {
        $this->captureTenantContext();
    }

    public function handle(Timeline $timeline): void
    {
        $import = Import::query()->find($this->importId);
        if ($import === null) {
            return;
        }
        $import->forceFill(['status' => 'running'])->save();

        $client = new ReporteiClient($this->token);
        $client->settings(); // valida o token antes de criar qualquer coisa

        $summary = ['projects_created' => 0, 'projects_existing' => 0, 'timeline_events' => 0, 'reconnect' => []];
        $existing = Project::query()->pluck('id', 'name')->all();

        foreach ($client->all('/projects') as $remote) {
            $name = self::text($remote['name'] ?? $remote['title'] ?? null);
            $remoteId = $remote['id'] ?? null;
            if ($name === '' || ! is_scalar($remoteId)) {
                continue;
            }

            $known = $existing[$name] ?? null;
            if (is_string($known)) {
                $projectId = $known;
                $summary['projects_existing']++;
            } else {
                $projectId = Project::query()->create(['name' => mb_substr($name, 0, 120)])->id;
                $existing[$name] = $projectId;
                $summary['projects_created']++;
            }

            foreach ($client->all('/integrations', ['project_id' => $remoteId]) as $integration) {
                $summary['reconnect'][] = [
                    'project' => $name,
                    'platform' => self::text($integration['name'] ?? $integration['slug'] ?? 'Integração'),
                    'account' => self::text($integration['account_name'] ?? $integration['title'] ?? data_get($integration, 'account.name')),
                ];
            }

            foreach ($client->all('/timeline-events', ['project_id' => $remoteId]) as $event) {
                $title = self::text($event['title'] ?? $event['name'] ?? null);
                $date = $event['date'] ?? $event['happened_at'] ?? $event['created_at'] ?? null;
                if ($title === '') {
                    continue;
                }
                $timeline->record($projectId, 'manual', $title, self::text($event['content'] ?? $event['description'] ?? null) ?: null,
                    is_string($date) ? CarbonImmutable::parse($date) : null, ['source' => 'reportei']);
                $summary['timeline_events']++;
            }
        }

        $import->forceFill(['status' => 'done', 'summary' => $summary])->save();
    }

    public function failed(?Throwable $e): void
    {
        Import::query()->whereKey($this->importId)->first()?->forceFill([
            'status' => 'failed',
            'error' => mb_substr($e?->getMessage() ?? 'Falha na importação.', 0, 300),
        ])->save();
    }

    /** Texto limpo (o Reportei guarda a linha do tempo em HTML). */
    private static function text(mixed $value): string
    {
        if (! is_scalar($value)) {
            return '';
        }

        $plain = html_entity_decode(strip_tags(str_replace(['<br>', '<br/>', '<br />', '</p>'], "\n", (string) $value)), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return trim((string) preg_replace('/[ \t]+/', ' ', $plain));
    }
}
