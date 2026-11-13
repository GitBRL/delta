<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Container\Container;

/**
 * Listener do Octane (RequestReceived/RequestTerminated/TaskReceived/TickReceived).
 * Reforço do ResetDatabaseContext: limpa o contexto de segurança do banco entre operações
 * do mesmo worker, inclusive tasks e ticks, que não passam pela pilha HTTP.
 */
final class ClearTenantContext
{
    public function handle(object $event): void
    {
        $app = property_exists($event, 'sandbox') && $event->sandbox instanceof Container
            ? $event->sandbox
            : app();

        $app->make(TenantContext::class)->clear();
    }
}
