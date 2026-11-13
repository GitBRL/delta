<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Id de correlação: aceita o X-Request-Id de quem chamou (proxy, balanceador) se for seguro,
 * senão gera um. Vai para os logs (Context) e para os jobs disparados neste request.
 */
final class RequestId
{
    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $incoming = $request->headers->get('X-Request-Id');
        $id = is_string($incoming) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $incoming) === 1 ? $incoming : (string) Str::uuid7();

        Context::add('request_id', $id);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $id);

        return $response;
    }
}
