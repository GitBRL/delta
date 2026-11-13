<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Metrics\Query\Comparison;
use App\Domain\Metrics\Query\MetricQuery;
use App\Domain\Metrics\Query\MetricQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\MetricQueryRequest;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;

final class ProjectMetricsController extends Controller
{
    public function __invoke(MetricQueryRequest $request, Project $project, MetricQueryService $service): JsonResponse
    {
        /** @var list<string> $metrics */
        $metrics = $request->validated('metrics');

        $result = $service->run(new MetricQuery(
            project: $project,
            start: CarbonImmutable::parse($request->string('start')->toString()),
            end: CarbonImmutable::parse($request->string('end')->toString()),
            comparison: $request->enum('compare', Comparison::class) ?? Comparison::None,
            metrics: $metrics,
            withSeries: $request->boolean('series'),
        ));

        return response()->json(['data' => $result]);
    }
}
