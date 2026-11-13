<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Storage;

use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;

/**
 * Partições mensais de metric_facts_daily.
 *
 * Só a role dona (delta_owner) cria partições. Cada partição nova tem os privilégios da
 * aplicação revogados: o RLS vale quando se consulta a tabela-mãe, não a partição direta.
 * Sem o REVOKE, o delta_app poderia ler uma partição e contornar o isolamento por agência.
 */
final class FactPartitions
{
    public const TABLE = 'metric_facts_daily';

    /** @return list<string> partições criadas nesta chamada */
    public static function ensure(Connection $owner, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $created = [];
        $month = $from->startOfMonth();

        while ($month->lte($to)) {
            $name = self::name($month);
            $exists = $owner->scalar('select to_regclass(?) is not null', ['public.'.$name]);

            if ($exists !== true) {
                $owner->statement(sprintf(
                    "CREATE TABLE %s PARTITION OF %s FOR VALUES FROM ('%s') TO ('%s')",
                    $name,
                    self::TABLE,
                    $month->toDateString(),
                    $month->addMonth()->toDateString(),
                ));
                $owner->statement("REVOKE ALL ON TABLE {$name} FROM delta_app, delta_readonly");
                $created[] = $name;
            }

            $month = $month->addMonth();
        }

        return $created;
    }

    public static function name(CarbonImmutable $month): string
    {
        return self::TABLE.'_'.$month->format('Y_m');
    }
}
