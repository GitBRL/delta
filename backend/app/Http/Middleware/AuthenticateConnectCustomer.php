<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\ConnectCustomer;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Delta Connect: "X-Customer-Token: dct_…" (depois do token do merchant). Coloca o projeto do
 * customer no contexto: daí em diante o banco só mostra as linhas desse projeto (ADR 0032).
 */
final readonly class AuthenticateConnectCustomer
{
    public function __construct(private TenantContext $context) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $token = (string) $request->header('X-Customer-Token');
        $customer = preg_match('/^dct_[A-Za-z0-9]{40}$/', $token) === 1
            ? ConnectCustomer::query()->where('token_hash', hash('sha256', $token))->whereNull('revoked_at')->first()
            : null;

        if ($customer === null) {
            return response()->json(['message' => 'Customer token inválido ou revogado (cabeçalho X-Customer-Token).'], 401);
        }

        $this->context->setCustomerProject($customer->project_id);
        $request->attributes->set('connect_customer', $customer);

        return $next($request);
    }
}
