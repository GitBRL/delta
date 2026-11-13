<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\TenantMembership;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Só a equipe da agência (dono, admin, analista). Usar depois do middleware "tenant". */
final class EnsureStaff
{
    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $membership = $request->attributes->get('membership');

        abort_unless($membership instanceof TenantMembership && $membership->role->canManageProjects(), 403, 'Ação permitida só à equipe da agência.');

        return $next($request);
    }
}
