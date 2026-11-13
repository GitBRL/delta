<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/** Todas as métricas da agência pela API v1: catálogo, indicadores personalizados e fonte manual. */
final class MetricCatalogController extends Controller
{
    public function __invoke(Catalog $catalog): JsonResponse
    {
        $set = MetricSet::forCurrentTenant($catalog);
        $data = [];
        foreach ($set->keys() as $key) {
            $spec = $set->metric($key);
            if ($spec instanceof MetricSpec && $spec->visible) {
                $data[] = [
                    'key' => $spec->key, 'provider' => $spec->provider(), 'label' => $spec->label, 'description' => $spec->description,
                    'unit' => $spec->unit->value, 'kind' => $spec->kind->value, 'direction' => $spec->direction->value, 'decimals' => $spec->decimals,
                ];
            }
        }

        return response()->json(['data' => $data]);
    }
}
