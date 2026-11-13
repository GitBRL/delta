<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Catalog;

/**
 * Como uma métrica se agrega em um período. Errar isso gera números diferentes dos que o
 * cliente vê na plataforma de origem.
 */
enum MetricKind: string
{
    /** Soma dos dias (investimento, cliques, conversões). */
    case Additive = 'additive';

    /** Valor no último dia do período (seguidores). */
    case Snapshot = 'snapshot';

    /** Não pode ser somado dia a dia (alcance, usuários únicos): consultado para o período exato. */
    case NonAdditive = 'non_additive';

    /** Calculado por fórmula sobre os totais do período (CTR, CPA, ROAS): razão das somas. */
    case Derived = 'derived';
}
