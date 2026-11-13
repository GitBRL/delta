<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Tenancy\AuthIdentifier;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Coloca o usuário autenticado (se houver) no contexto de segurança do banco. */
final readonly class SetUserContext
{
    public function __construct(private TenantContext $context) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user !== null) {
            $this->context->setUser(AuthIdentifier::of($user));
        }

        return $next($request);
    }
}
