<?php

declare(strict_types=1);

namespace App\Domain\Messaging\WhatsApp;

use RuntimeException;

/** Falha de envio com mensagem pronta para a agência. */
final class WhatsAppException extends RuntimeException {}
