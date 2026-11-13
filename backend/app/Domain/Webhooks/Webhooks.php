<?php

declare(strict_types=1);

namespace App\Domain\Webhooks;

use App\Jobs\DeliverWebhook;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use Throwable;

/**
 * Webhooks de saída da agência do contexto. Cada evento vira uma entrega por endpoint inscrito,
 * enviada em fila com assinatura e novas tentativas. Emitir nunca derruba a operação principal.
 */
final class Webhooks
{
    public const EVENTS = [
        'report.published' => 'Relatório publicado (nova versão)',
        'automation.sent' => 'Envio automático concluído',
        'automation.failed' => 'Envio automático falhou',
        'goal.status_changed' => 'Meta mudou de estado',
        'connection.expired' => 'Conexão com plataforma expirou',
        'action.measured' => 'Resultado de ação medido',
        'post.approved' => 'Post aprovado pelo cliente',
        'post.changes_requested' => 'Cliente pediu ajustes num post',
        'post.published' => 'Post publicado em todas as redes',
        'post.failed' => 'Post falhou em alguma rede',
        'connect.metrics_ready' => 'Connect: resultado de métricas assíncronas',
        'customer_integration.connected' => 'Connect: cliente conectou uma conta pela sessão hospedada',
        'ads.changed' => 'Campanha ou conjunto de anúncios alterado pelo Delta',
    ];

    /** @param array<string, mixed> $data */
    public static function emit(string $event, array $data): void
    {
        try {
            $endpoints = WebhookEndpoint::query()->where('active', true)->whereNull('disabled_at')->get()
                ->filter(fn (WebhookEndpoint $e): bool => in_array($event, $e->events, true) || in_array('*', $e->events, true));

            foreach ($endpoints as $endpoint) {
                self::deliver($endpoint, $event, $data);
            }
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** @param array<string, mixed> $data */
    public static function deliver(WebhookEndpoint $endpoint, string $event, array $data): WebhookDelivery
    {
        $delivery = WebhookDelivery::query()->create([
            'endpoint_id' => $endpoint->id,
            'event' => $event,
            'payload' => ['event' => $event, 'created_at' => now()->toIso8601String(), 'data' => $data],
            'status' => 'pending',
        ]);
        try {
            DeliverWebhook::dispatch($delivery->id);
        } catch (Throwable $e) {
            report($e); // fila síncrona: a falha já ficou registrada na entrega
        }

        return $delivery;
    }

    /** Cabeçalho X-Delta-Signature: "t=<unix>,v1=<hmac-sha256(secret, "<t>.<corpo>")>". */
    public static function signature(string $secret, int $timestamp, string $body): string
    {
        return 't='.$timestamp.',v1='.hash_hmac('sha256', $timestamp.'.'.$body, $secret);
    }
}
