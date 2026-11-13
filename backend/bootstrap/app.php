<?php

declare(strict_types=1);

use App\Http\Middleware\AuthenticateApiToken;
use App\Http\Middleware\AuthenticateConnectCustomer;
use App\Http\Middleware\EnsurePlanFeature;
use App\Http\Middleware\EnsureStaff;
use App\Http\Middleware\EnsureTenantAdmin;
use App\Http\Middleware\RequestId;
use App\Http\Middleware\RequireApiScope;
use App\Http\Middleware\ResetDatabaseContext;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SecurityHeaders;
use App\Http\Middleware\SetUserContext;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Primeiro da pilha: nenhum request começa (ou termina) com contexto de outro.
        $middleware->prepend(ResetDatabaseContext::class);
        $middleware->prepend(RequestId::class);
        $middleware->append(SecurityHeaders::class);

        // SPA autenticada por sessão (cookies same-origin via proxy do Angular).
        $middleware->statefulApi();
        $middleware->throttleApi();

        // Sem login: a API responde 401 (nunca redireciona); páginas web levam ao login do app.
        $middleware->redirectGuestsTo(function (Request $request): ?string {
            $frontend = config('delta.frontend_url');

            return $request->is('api/*', 'auth/*') ? null : rtrim(is_string($frontend) ? $frontend : '', '/').'/login';
        });

        // Rotas web (Fortify em /auth/*): usuário autenticado entra no contexto do banco.
        $middleware->web(append: [SetUserContext::class]);

        $middleware->alias([
            'context.user' => SetUserContext::class,
            'plan.feature' => EnsurePlanFeature::class,
            'connect.customer' => AuthenticateConnectCustomer::class,
            'tenant' => ResolveTenant::class,
            'staff' => EnsureStaff::class,
            'tenant.admin' => EnsureTenantAdmin::class,
            'api.token' => AuthenticateApiToken::class,
            'api.scope' => RequireApiScope::class,
        ]);

        // O contexto de segurança precisa existir ANTES do route model binding: sem ele, o RLS
        // esconde o registro e {project} viraria 404 até para o dono. A lista de prioridade já
        // coloca a autenticação antes do SubstituteBindings; nossos middlewares entram entre os dois.
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: SetUserContext::class);
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class);
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: AuthenticateApiToken::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'auth/*') || $request->expectsJson(),
        );
    })->create();
