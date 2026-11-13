<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Webhooks\UrlGuard;
use App\Domain\Webhooks\Webhooks;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Entrega de um webhook: POST JSON assinado, sem seguir redirecionamentos, 10 s de limite.
 * Novas tentativas por até ~3 dias; 20 falhas seguidas desativam o endpoint.
 */
final class DeliverWebhook implements ShouldQueue
{
    use Queueable, TenantScopedJob;

    public const DISABLE_AFTER = 20;

    public int $tries = 8;

    /** @var list<int> */
    public array $backoff = [60, 300, 1800, 7200, 21600, 43200, 86400];

    public function __construct(public readonly string $deliveryId)
    {
        $this->captureTenantContext();
        $this->onQueue('webhooks');
    }

    public function handle(UrlGuard $guard): void
    {
        $delivery = WebhookDelivery::query()->find($this->deliveryId);
        $endpoint = $delivery === null ? null : WebhookEndpoint::query()->find($delivery->endpoint_id);
        if ($delivery === null || $endpoint === null || $delivery->status === 'delivered' || $endpoint->disabled_at !== null) {
            return;
        }

        $body = (string) json_encode(['id' => $delivery->id, ...$delivery->payload], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $timestamp = now()->getTimestamp();
        $delivery->forceFill(['attempts' => $delivery->attempts + 1])->save();

        try {
            $guard->check($endpoint->url); // de novo a cada entrega (DNS pode mudar)
            $response = Http::timeout(10)->withOptions(['allow_redirects' => false])->withHeaders([
                'User-Agent' => 'Delta-Webhooks/1.0',
                'X-Delta-Event' => $delivery->event,
                'X-Delta-Delivery' => $delivery->id,
                'X-Delta-Signature' => Webhooks::signature($endpoint->secret, $timestamp, $body),
            ])->withBody($body, 'application/json')->post($endpoint->url);
        } catch (ValidationException $e) {
            $this->giveUp($delivery, $endpoint, null, $e->getMessage());

            return;
        } catch (Throwable $e) {
            $delivery->forceFill(['last_error' => mb_substr($e->getMessage(), 0, 300)])->save();

            throw $e;
        }

        if ($response->successful()) {
            $delivery->forceFill(['status' => 'delivered', 'delivered_at' => now(), 'last_status_code' => $response->status(), 'last_error' => null])->save();
            $endpoint->forceFill(['failure_count' => 0])->save();

            return;
        }

        $delivery->forceFill(['last_status_code' => $response->status(), 'last_error' => 'HTTP '.$response->status()])->save();

        throw new RuntimeException("Webhook respondeu HTTP {$response->status()}");
    }

    public function failed(?Throwable $e): void
    {
        $delivery = WebhookDelivery::query()->find($this->deliveryId);
        $endpoint = $delivery === null ? null : WebhookEndpoint::query()->find($delivery->endpoint_id);
        if ($delivery !== null && $endpoint !== null) {
            $this->giveUp($delivery, $endpoint, $delivery->last_status_code, $e?->getMessage() ?? 'Falha na entrega.');
        }
    }

    private function giveUp(WebhookDelivery $delivery, WebhookEndpoint $endpoint, ?int $code, string $error): void
    {
        $delivery->forceFill(['status' => 'failed', 'last_status_code' => $code, 'last_error' => mb_substr($error, 0, 300)])->save();
        $failures = $endpoint->failure_count + 1;
        $endpoint->forceFill(['failure_count' => $failures, 'disabled_at' => $failures >= self::DISABLE_AFTER ? now() : null])->save();
    }
}
