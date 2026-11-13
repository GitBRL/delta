<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use RuntimeException;

/** A rede ainda está processando a mídia (vídeo): o destino volta para a fila e tenta de novo. */
final class StillProcessing extends RuntimeException {}
