<?php

declare(strict_types=1);

namespace App\Domain\Ai;

use RuntimeException;

/** Falha do copiloto com mensagem pronta para a agência. */
final class AiException extends RuntimeException {}
