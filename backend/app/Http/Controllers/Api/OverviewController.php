<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Insights\Overview;
use App\Domain\Metrics\Query\Comparison;
use App\Domain\Reports\ReportPeriod;
use App\Http\Controllers\Controller;
use App\Models\TenantMembership;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * Visão geral da agência. Cache de 10 minutos por agência, período e ESCOPO: o cliente vê só os
 * próprios projetos (RLS), então a chave dele inclui o usuário. ?refresh=1 recalcula.
 */
final class OverviewController extends Controller
{
    public const TTL_SECONDS = 600;

    public function __invoke(Request $request, Overview $overview, TenantContext $context): JsonResponse
    {
        $request->validate([
            'period_preset' => ['sometimes', Rule::in(['last_7', 'last_14', 'last_30', 'last_month', 'this_month'])],
            'compare' => ['sometimes', Rule::enum(Comparison::class)],
        ]);

        $preset = $request->string('period_preset', 'last_30')->toString();
        $compare = Comparison::from($request->string('compare', Comparison::PreviousPeriod->value)->toString());
        $period = ReportPeriod::resolve($preset);

        $membership = $request->attributes->get('membership');
        $scope = $membership instanceof TenantMembership && $membership->role === TenantRole::Client ? 'client:'.$context->userId() : 'staff';
        $key = "overview:{$context->tenantId()}:{$scope}:{$period->start->toDateString()}:{$period->end->toDateString()}:{$compare->value}";

        if ($request->boolean('refresh')) {
            Cache::forget($key);
        }

        $data = Cache::remember($key, self::TTL_SECONDS, fn (): array => [...$overview->build($period, $compare), 'generated_at' => now()->toIso8601String()]);

        return response()->json(['data' => $data]);
    }
}
