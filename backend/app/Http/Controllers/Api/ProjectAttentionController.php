<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Insights\AttentionEvaluator;
use App\Http\Controllers\Controller;
use App\Http\Requests\AttentionRequest;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;

final class ProjectAttentionController extends Controller
{
    public function __invoke(AttentionRequest $request, Project $project, AttentionEvaluator $evaluator): JsonResponse
    {
        return response()->json(['data' => $evaluator->evaluate(
            $project,
            CarbonImmutable::parse($request->string('start')->toString()),
            CarbonImmutable::parse($request->string('end')->toString()),
        )]);
    }
}
