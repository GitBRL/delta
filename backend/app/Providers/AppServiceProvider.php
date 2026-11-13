<?php

declare(strict_types=1);

namespace App\Providers;

use App\Auth\Passkeys\RlsStorePasskey;
use App\Auth\Passkeys\RlsVerifyPasskey;
use App\Auth\RlsUserProvider;
use App\Domain\Ai\AiWriter;
use App\Domain\Ai\ClaudeWriter;
use App\Domain\Metrics\Catalog\Catalog;
use App\Support\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Passkeys\Actions\StorePasskey;
use Laravel\Passkeys\Actions\VerifyPasskey;
use Laravel\Sanctum\Sanctum;
use LogicException;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Copiloto de IA: Claude pela API oficial (os testes trocam por um escritor falso).
        $this->app->bind(AiWriter::class, ClaudeWriter::class);
        // Passkeys sob RLS (ADR 0025).
        $this->app->bind(VerifyPasskey::class, RlsVerifyPasskey::class);
        $this->app->bind(StorePasskey::class, RlsStorePasskey::class);

        // "scoped": uma instância por request/job (o Octane descarta ao fim de cada operação).
        $this->app->scoped(TenantContext::class);

        // Catálogo imutável (vem do código): uma instância por processo, com as fórmulas compiladas.
        $this->app->singleton(Catalog::class);
    }

    public function boot(): void
    {
        Model::shouldBeStrict(! $this->app->isProduction());

        // A SPA autentica por cookie; "Bearer" é só dos tokens da API (dlt_, middleware api.token).
        // Sem isto, qualquer $request->user() com Bearer consultaria personal_access_tokens (não usada).
        Sanctum::getAccessTokenFromRequestUsing(fn (): ?string => null);

        Auth::provider('rls-eloquent', function (Application $app, array $config): RlsUserProvider {
            $model = $config['model'] ?? null;

            if (! is_string($model)) {
                throw new LogicException('auth.providers.users.model precisa ser o nome de uma classe.');
            }

            return new RlsUserProvider($app->make(Hasher::class), $model, $app->make(TenantContext::class));
        });

        // Se a conexão cair e o Laravel reconectar, o contexto de segurança precisa ser reaplicado
        // na nova sessão do Postgres; senão as consultas seguintes não veriam nada (ou, pior,
        // um pool externo poderia devolver outra sessão).
        Event::listen(function (ConnectionEstablished $event): void {
            $this->app->make(TenantContext::class)->reapply($event->connection);
        });

        // Workers de fila são processos longos: nenhum job herda contexto de outro.
        // No driver "sync" o job roda dentro do request que o disparou; limpar ali apagaria o
        // contexto do próprio request (o TenantAware já restaura o contexto anterior ao terminar).
        $clear = function (JobProcessing|JobProcessed|JobFailed $event): void {
            if ($event->connectionName !== 'sync') {
                $this->app->make(TenantContext::class)->clear();
            }
        };
        Queue::before($clear);
        Queue::after($clear);
        Queue::failing($clear);

        // API pública: limite por token (ADR 0020).
        RateLimiter::for('api-v1', function (Request $request): Limit {
            $token = $request->attributes->get('api_token_id');

            return Limit::perMinute(120)->by('token:'.(is_string($token) ? $token : $request->ip()));
        });

        // A API v1 tem limite próprio por token (e não deve tentar resolver usuário pelo Bearer).
        RateLimiter::for('api', fn (Request $request) => $request->is('api/v1/*', 'api/connect/*') ? Limit::none() : Limit::perMinute(120)->by(
            $request->user()?->getAuthIdentifier() ?: $request->ip(),
        ));
    }
}
