<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Reports\ReportTemplates;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

final class ReportTemplateController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json(['data' => ReportTemplates::all()]);
    }
}
