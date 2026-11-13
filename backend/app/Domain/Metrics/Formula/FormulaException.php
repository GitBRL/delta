<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Formula;

use InvalidArgumentException;

/** Fórmula inválida (sintaxe, referência desconhecida, ciclo). Mensagens em pt-BR para o usuário final. */
final class FormulaException extends InvalidArgumentException {}
