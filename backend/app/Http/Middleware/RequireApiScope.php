<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Exige um escopo do token da API pública (ex.: api.scope:metrics:read). */
final class RequireApiScope
{
    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next, string $scope): Response
    {
        $scopes = $request->attributes->get('api_scopes');

        if (! is_array($scopes) || ! in_array($scope, $scopes, true)) {
            return response()->json(['message' => "Este token não tem o escopo {$scope}."], 403);
        }

        return $next($request);
    }
}
