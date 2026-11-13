<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\PublicApi\ApiTokens;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * API pública v1: "Authorization: Bearer dlt_…". O token define a agência do contexto (sem
 * usuário; tudo sob RLS) e os escopos permitidos (middleware api.scope). ADR 0020.
 */
final readonly class AuthenticateApiToken
{
    public function __construct(private TenantContext $context) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $row = ApiTokens::lookup((string) $request->bearerToken());

        $invalid = $row === null
            || $row->revoked_at !== null
            || ($row->expires_at !== null && CarbonImmutable::parse($row->expires_at)->isPast());
        if ($invalid) {
            return response()->json(['message' => 'Token de API inválido, expirado ou revogado.'], 401, ['WWW-Authenticate' => 'Bearer']);
        }

        $scopes = json_decode($row->scopes, true);
        $this->context->set($row->tenant_id, null);
        $request->attributes->set('api_token_id', $row->token_id);
        $request->attributes->set('api_scopes', is_array($scopes) ? $scopes : []);
        DB::statement('select app.touch_api_token(?)', [$row->token_id]);

        return $next($request);
    }
}
