<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\Connect;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\MetricQueryRequest;
use App\Jobs\ComputeConnectMetrics;
use App\Models\ConnectCustomer;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Delta Connect, lado do customer (token do merchant + X-Customer-Token): tudo restrito ao
 * projeto do customer pelo próprio banco (política RESTRICTIVE). ADR 0032.
 */
final class CustomerController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $customer = self::customer($request);

        return response()->json(['data' => MerchantController::present($customer->load('project:id,name,niche'), withIntegrations: true)]);
    }

    /** Métricas disponíveis para as integrações do customer (mais indicadores e fonte manual). */
    public function metrics(Request $request, Catalog $catalog): JsonResponse
    {
        $project = Project::query()->findOrFail(self::customer($request)->project_id);
        $providers = [...$project->accounts()->pluck('provider')->unique()->all(), 'custom', 'manual'];
        $set = MetricSet::forCurrentTenant($catalog);
        $data = [];
        foreach ($set->keys() as $key) {
            $spec = $set->metric($key);
            if ($spec instanceof MetricSpec && $spec->visible && in_array($spec->provider(), $providers, true)) {
                $data[] = ['reference_key' => $spec->key, 'provider' => $spec->provider(), 'label' => $spec->label, 'unit' => $spec->unit->value, 'kind' => $spec->kind->value, 'direction' => $spec->direction->value];
            }
        }

        return response()->json(['data' => $data]);
    }

    public function getData(MetricQueryRequest $request, MetricQueryService $service): JsonResponse
    {
        /** @var list<string> $metrics */
        $metrics = $request->validated('metrics');
        $project = Project::query()->findOrFail(self::customer($request)->project_id);

        return response()->json(['data' => $service->run(new MetricQuery(
            project: $project,
            start: CarbonImmutable::parse($request->string('start')->toString()),
            end: CarbonImmutable::parse($request->string('end')->toString()),
            comparison: $request->enum('compare', Comparison::class) ?? Comparison::None,
            metrics: $metrics,
            withSeries: $request->boolean('series'),
        ))]);
    }

    /** Assíncrono: 202 com request_id; o resultado chega no webhook "connect.metrics_ready". */
    public function getDataAsync(MetricQueryRequest $request): JsonResponse
    {
        /** @var list<string> $metrics */
        $metrics = $request->validated('metrics');
        $requestId = (string) Str::uuid7();
        ComputeConnectMetrics::dispatch(
            self::customer($request)->id, $requestId, $metrics,
            $request->string('start')->toString(), $request->string('end')->toString(),
            ($request->enum('compare', Comparison::class) ?? Comparison::None)->value, $request->boolean('series'),
        );

        return response()->json(['data' => ['request_id' => $requestId, 'status' => 'queued', 'webhook_event' => 'connect.metrics_ready']], 202);
    }

    private static function customer(Request $request): ConnectCustomer
    {
        $customer = $request->attributes->get('connect_customer');
        abort_unless($customer instanceof ConnectCustomer, 401);

        return $customer;
    }
}
