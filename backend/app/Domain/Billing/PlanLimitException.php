<?php

declare(strict_types=1);

namespace App\Domain\Billing;

use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/** Limite ou recurso fora do plano: 402 com a explicação e o que fazer (ADR 0031). Regra de negócio: não vai para o log. */
final class PlanLimitException extends RuntimeException implements ShouldntReport
{
    public function __construct(string $message, public readonly string $limit, public readonly ?int $allowed = null, public readonly ?int $used = null)
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'errors' => ['plan' => [$this->getMessage()]],
            'plan_limit' => ['limit' => $this->limit, 'allowed' => $this->allowed, 'used' => $this->used],
        ], 402);
    }
}
