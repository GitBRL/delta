<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/** Plano, limites, uso e catálogo de planos da agência (dono e administrador). ADR 0031. */
final class BillingController extends Controller
{
    public function show(Entitlements $entitlements): JsonResponse
    {
        return response()->json(['data' => [
            ...$entitlements->current(),
            'usage' => $entitlements->usage(),
            'plans' => array_map(fn (string $key, array $spec): array => ['key' => $key, ...$spec], array_keys(Entitlements::plans()), Entitlements::plans()),
            // Pagamento pela tela: depende da escolha do provedor (decisão em aberto).
            'checkout_available' => false,
            'contact' => 'Para mudar de plano, fale com a equipe do Delta.',
        ]]);
    }
}
