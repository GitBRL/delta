<?php

declare(strict_types=1);

namespace App\Domain\Insights;

/** Regra do semáforo de atenção. Devolve um sinal quando algo está fora do esperado, ou nulo. */
interface Rule
{
    public function id(): string;

    /** Plataforma de que a regra depende: só roda se o projeto tiver conta dela. */
    public function provider(): string;

    /**
     * Métricas que a regra lê (o avaliador consulta todas de uma vez). A PRIMEIRA é a métrica
     * sobre a qual a regra fala: recebe o estado "saudável" quando a regra não dispara.
     *
     * @return list<string>
     */
    public function metrics(): array;

    public function evaluate(RuleContext $context): ?Signal;
}
