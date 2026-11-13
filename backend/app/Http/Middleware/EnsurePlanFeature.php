<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Billing\Entitlements;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Recurso do plano exigido pela rota (API v1, MCP): 402 se a agência não tem (ADR 0031). */
final readonly class EnsurePlanFeature
{
    public function __construct(private Entitlements $entitlements) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next, string $feature): Response
    {
        $this->entitlements->ensureFeature($feature);

        return $next($request);
    }
}
