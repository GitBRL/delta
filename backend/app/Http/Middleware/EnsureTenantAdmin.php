<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\TenantMembership;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Só dono e administrador da agência. Usar depois do middleware "tenant". O banco reforça (app.is_tenant_admin). */
final class EnsureTenantAdmin
{
    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $membership = $request->attributes->get('membership');

        abort_unless(
            $membership instanceof TenantMembership && $membership->role->canAdministerAgency(),
            403,
            'Só donos e administradores da agência configuram os apps das plataformas.',
        );

        return $next($request);
    }
}
