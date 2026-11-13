<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Webhooks\UrlGuard;
use App\Domain\Webhooks\Webhooks;
use App\Http\Controllers\Controller;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Webhooks de saída (dono/admin pelo app; ou token com webhooks:manage pela API v1).
 * O segredo de assinatura aparece só na criação e na rotação.
 */
final class WebhookController extends Controller
{
    public function __construct(
        private readonly UrlGuard $guard,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => WebhookEndpoint::query()->orderBy('created_at')->get()->map(self::present(...))->values()->all(),
            'events' => Webhooks::EVENTS,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->validated($request);
        $secret = 'whsec_'.Str::random(40);
        $endpoint = WebhookEndpoint::query()->create([
            'url' => $request->string('url')->toString(),
            'description' => $request->filled('description') ? $request->string('description')->toString() : null,
            'events' => self::events($request),
            'secret' => $secret,
            'active' => true,
            'created_by' => $this->context->userId(),
        ]);
        $this->audit->record('webhook.created', $endpoint, ['events' => $endpoint->events]);

        return response()->json(['data' => self::present($endpoint), 'secret' => $secret], 201);
    }

    public function update(Request $request, WebhookEndpoint $webhook): JsonResponse
    {
        $this->validated($request);
        $webhook->forceFill([
            'url' => $request->string('url')->toString(),
            'description' => $request->filled('description') ? $request->string('description')->toString() : null,
            'events' => self::events($request),
            'active' => $request->boolean('active', true),
            'disabled_at' => $request->boolean('active', true) ? null : $webhook->disabled_at,
            'failure_count' => $request->boolean('active', true) ? 0 : $webhook->failure_count,
        ])->save();

        return response()->json(['data' => self::present($webhook)]);
    }

    public function destroy(WebhookEndpoint $webhook): Response
    {
        $this->audit->record('webhook.deleted', $webhook, ['url' => $webhook->url]);
        $webhook->delete();

        return response()->noContent();
    }

    public function rotate(WebhookEndpoint $webhook): JsonResponse
    {
        $secret = 'whsec_'.Str::random(40);
        $webhook->forceFill(['secret' => $secret])->save();
        $this->audit->record('webhook.secret_rotated', $webhook);

        return response()->json(['data' => self::present($webhook), 'secret' => $secret]);
    }

    /** Evento "ping" para testar a integração do cliente. */
    public function test(WebhookEndpoint $webhook): JsonResponse
    {
        $delivery = Webhooks::deliver($webhook, 'ping', ['message' => 'Webhook do Delta configurado com sucesso.']);

        return response()->json(['data' => self::presentDelivery($delivery->refresh())], 202);
    }

    public function deliveries(WebhookEndpoint $webhook): JsonResponse
    {
        return response()->json(['data' => WebhookDelivery::query()->where('endpoint_id', $webhook->id)->orderByDesc('created_at')->limit(100)->get()
            ->map(self::presentDelivery(...))->values()->all()]);
    }

    private function validated(Request $request): void
    {
        $request->validate([
            'url' => ['required', 'string', 'url', 'max:500'],
            'description' => ['nullable', 'string', 'max:120'],
            'events' => ['required', 'array', 'min:1'],
            'events.*' => [Rule::in(['*', ...array_keys(Webhooks::EVENTS)])],
            'active' => ['boolean'],
        ], ['events.required' => 'Escolha ao menos um evento.']);
        $this->guard->check($request->string('url')->toString());
    }

    /** @return list<string> */
    private static function events(Request $request): array
    {
        return array_values(array_unique(array_filter((array) $request->input('events'), 'is_string')));
    }

    /** @return array<string, mixed> */
    private static function present(WebhookEndpoint $e): array
    {
        return [
            'id' => $e->id, 'url' => $e->url, 'description' => $e->description, 'events' => $e->events, 'active' => $e->active,
            'failure_count' => $e->failure_count, 'disabled_at' => $e->disabled_at?->toIso8601String(), 'created_at' => $e->created_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private static function presentDelivery(WebhookDelivery $d): array
    {
        return [
            'id' => $d->id, 'event' => $d->event, 'status' => $d->status, 'attempts' => $d->attempts, 'last_status_code' => $d->last_status_code,
            'last_error' => $d->last_error, 'delivered_at' => $d->delivered_at?->toIso8601String(), 'created_at' => $d->created_at?->toIso8601String(),
        ];
    }
}
