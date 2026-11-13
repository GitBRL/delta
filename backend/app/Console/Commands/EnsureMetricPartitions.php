<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Metrics\Storage\FactPartitions;
use Carbon\CarbonImmutable;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Cria as partições mensais de metric_facts_daily com antecedência. Roda com a role dona. */
#[Signature('metrics:partitions {--ahead=12 : Meses à frente} {--behind=26 : Meses para trás}')]
#[Description('Garante as partições mensais da tabela de métricas diárias')]
final class EnsureMetricPartitions extends Command
{
    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $created = FactPartitions::ensure(
            DB::connection('pgsql_owner'),
            $now->subMonths((int) $this->option('behind')),
            $now->addMonths((int) $this->option('ahead')),
        );

        $this->info($created === [] ? 'Nenhuma partição nova.' : 'Criadas: '.implode(', ', $created));

        return self::SUCCESS;
    }
}
