<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Middleware global (o primeiro da pilha). Garante que nenhum request herda contexto de
 * segurança de outro, o que é essencial com Octane, onde a conexão do banco persiste
 * entre requests no mesmo worker.
 */
final readonly class ResetDatabaseContext
{
    public function __construct(private TenantContext $context) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $this->context->clear();

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $this->context->clear();
    }
}
