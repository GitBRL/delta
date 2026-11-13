<?php

declare(strict_types=1);

namespace App\Domain\Sync;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\AccessTokens;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Models\IntegrationConnection;
use App\Models\SheetSync;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Monta a tabela diária (uma linha por dia, uma coluna por métrica) e grava na planilha.
 * Em demonstração, guarda só a prévia, sem chamar o Google. ADR 0027.
 */
final readonly class SheetSyncRunner
{
    public const PREVIEW_ROWS = 15;

    public function __construct(
        private MetricQueryService $metrics,
        private AccessTokens $tokens,
        private GoogleSheets $sheets,
    ) {}

    public function run(SheetSync $sync): void
    {
        $sync->forceFill(['last_status' => 'running', 'last_run_at' => now()])->save();

        try {
            $rows = $this->table($sync);
            $connection = IntegrationConnection::query()->findOrFail($sync->connection_id);

            if ($connection->isSandbox()) {
                $sync->spreadsheet_url = null;
            } else {
                $this->write($sync, $connection, $rows);
            }

            $sync->forceFill([
                'last_status' => 'ok',
                'last_error' => null,
                'last_preview' => ['rows' => array_slice($rows, 0, self::PREVIEW_ROWS + 1), 'total_rows' => count($rows) - 1],
            ])->save();
        } catch (ValidationException|LiveApiException|ConnectorUnavailable $e) {
            $message = $e instanceof ValidationException ? collect($e->errors())->flatten()->first() : $e->getMessage();
            $sync->forceFill(['last_status' => 'error', 'last_error' => mb_substr(is_string($message) ? $message : 'Falha na exportação.', 0, 500)])->save();

            if ($e instanceof LiveApiException && $e->retryable) {
                throw $e; // a fila tenta de novo
            }
        } catch (Throwable $e) {
            $sync->forceFill(['last_status' => 'error', 'last_error' => 'Falha inesperada na exportação. A equipe técnica foi avisada.'])->save();

            throw $e;
        }
    }

    /** @return list<list<string|float|null>> cabeçalho + uma linha por dia */
    public function table(SheetSync $sync): array
    {
        $end = ConnectionManager::yesterday();
        $start = $end->subDays($sync->days - 1);
        $result = $this->metrics->run(new MetricQuery(
            project: $sync->project()->firstOrFail(),
            start: $start,
            end: $end,
            comparison: Comparison::None,
            metrics: $sync->metrics,
            withSeries: true,
        ));

        $header = ['Data'];
        $byDate = [];
        foreach ($result['metrics'] as $i => $metric) {
            $label = is_string($metric['label'] ?? null) ? $metric['label'] : (is_string($metric['key'] ?? null) ? $metric['key'] : '');
            $header[] = $label.(($metric['unit'] ?? null) === 'percent' ? ' (%)' : '');
            $series = $metric['series'] ?? [];
            foreach (is_array($series) ? $series : [] as $point) {
                if (is_array($point) && is_string($point['date'] ?? null)) {
                    $byDate[$point['date']][$i] = $point['value'] ?? null;
                }
            }
        }

        $rows = [$header];
        for ($day = $start; $day->lte($end); $day = $day->addDay()) {
            $row = [$day->toDateString()];
            foreach (array_keys($result['metrics']) as $i) {
                $value = $byDate[$day->toDateString()][$i] ?? null;
                $row[] = is_int($value) || is_float($value) ? (float) $value : null;
            }
            $rows[] = $row;
        }

        return $rows;
    }

    /** @param list<list<string|float|null>> $rows */
    private function write(SheetSync $sync, IntegrationConnection $connection, array $rows): void
    {
        $token = $this->tokens->for($connection);

        if ($sync->spreadsheet_id !== null && $this->sheets->replace($token, $sync->spreadsheet_id, $rows)) {
            return;
        }

        // Primeira vez, ou a planilha foi apagada no Drive: cria outra.
        $project = $sync->project()->firstOrFail();
        $created = $this->sheets->create($token, "Delta · {$project->name} · {$sync->name}");
        $sync->forceFill(['spreadsheet_id' => $created['id'], 'spreadsheet_url' => $created['url']])->save();
        $this->sheets->replace($token, $created['id'], $rows);
    }
}
