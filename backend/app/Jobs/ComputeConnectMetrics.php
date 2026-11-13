<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Domain\Webhooks\Webhooks;
use App\Models\ConnectCustomer;
use App\Models\Project;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScopedJob;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Validation\ValidationException;

/**
 * Métricas assíncronas do Delta Connect: calcula no escopo do customer e entrega pelo webhook
 * "connect.metrics_ready" (assinado, com novas tentativas). ADR 0032.
 */
final class ComputeConnectMetrics implements ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 3;

    /** @param list<string> $metrics */
    public function __construct(
        public readonly string $customerId,
        public readonly string $requestId,
        public readonly array $metrics,
        public readonly string $start,
        public readonly string $end,
        public readonly string $compare,
        public readonly bool $series,
    ) {
        $this->captureTenantContext();
        $this->onQueue('metrics');
    }

    public function handle(TenantContext $context, MetricQueryService $service): void
    {
        $customer = ConnectCustomer::query()->whereKey($this->customerId)->whereNull('revoked_at')->first();
        if ($customer === null) {
            return;
        }

        $context->setCustomerProject($customer->project_id);
        try {
            $data = $service->run(new MetricQuery(
                Project::query()->findOrFail($customer->project_id),
                CarbonImmutable::parse($this->start), CarbonImmutable::parse($this->end),
                Comparison::tryFrom($this->compare) ?? Comparison::None, $this->metrics, $this->series,
            ));
            $payload = ['request_id' => $this->requestId, 'customer_id' => $customer->id, 'external_id' => $customer->external_id, 'status' => 'done', 'data' => $data];
        } catch (ValidationException $e) {
            $payload = ['request_id' => $this->requestId, 'customer_id' => $customer->id, 'external_id' => $customer->external_id, 'status' => 'failed', 'errors' => $e->errors()];
        } finally {
            $context->setCustomerProject(null);
        }

        Webhooks::emit('connect.metrics_ready', $payload);
    }
}
