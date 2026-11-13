<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\TenantMembership;
use App\Support\Tenancy\AuthIdentifier;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolve a agência do request pelo header X-Tenant-Id, confirma que o usuário é membro
 * e define o contexto de segurança. O vínculo fica disponível em $request->attributes('membership').
 *
 *  400 header ausente ou inválido · 403 usuário não pertence à agência
 */
final readonly class ResolveTenant
{
    public const HEADER = 'X-Tenant-Id';

    public function __construct(private TenantContext $context) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        abort_if($user === null, 401);

        $tenantId = $request->header(self::HEADER);
        abort_if(! is_string($tenantId) || ! Str::isUuid($tenantId), 400, 'Header X-Tenant-Id ausente ou inválido.');

        $userId = AuthIdentifier::of($user);
        $this->context->setUser($userId);

        $membership = TenantMembership::query()
            ->where('tenant_id', strtolower($tenantId))
            ->where('user_id', $userId)
            ->first();

        abort_if($membership === null, 403, 'Sem acesso a esta agência.');

        $this->context->setTenant($membership->tenant_id);
        $request->attributes->set('membership', $membership);

        return $next($request);
    }
}
