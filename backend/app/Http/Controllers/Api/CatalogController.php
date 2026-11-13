<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Integrations\OAuth\Apps\AppVendor;
use App\Domain\Integrations\OAuth\OAuthRegistry;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSpec;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Catálogo de plataformas e métricas. As métricas são iguais para todas as agências; as
 * plataformas dizem se o login real está disponível para a agência do request (X-Tenant-Id),
 * porque isso depende do app que ela cadastrou.
 */
final class CatalogController extends Controller
{
    public function __construct(private readonly Catalog $catalog) {}

    public function providers(OAuthRegistry $oauth): JsonResponse
    {
        $data = [];
        foreach ($this->catalog->providers() as $provider) {
            $visible = array_filter($provider->metrics(), fn (MetricSpec $m) => $m->visible);

            $data[] = [
                'key' => $provider->key(),
                'name' => $provider->name(),
                'category' => $provider->category(),
                'app_vendor' => AppVendor::forPlatform($provider->key())?->value,
                'available_modes' => $oauth->modes($provider->key()),
                'live_note' => $oauth->liveNote($provider->key()),
                'metrics_count' => count($visible),
                'featured_metrics' => array_values(array_map(
                    fn (MetricSpec $m) => $m->key,
                    array_filter($visible, fn (MetricSpec $m) => $m->featured),
                )),
            ];
        }

        return response()->json(['data' => $data]);
    }

    public function metrics(Request $request): JsonResponse
    {
        $provider = $request->string('provider')->toString();

        $data = [];
        foreach ($this->catalog->metrics() as $metric) {
            if (! $metric->visible || ($provider !== '' && $metric->provider() !== $provider)) {
                continue;
            }

            $data[] = [
                'key' => $metric->key,
                'provider' => $metric->provider(),
                'label' => $metric->label,
                'description' => $metric->description,
                'unit' => $metric->unit->value,
                'kind' => $metric->kind->value,
                'direction' => $metric->direction->value,
                'decimals' => $metric->decimals,
                'featured' => $metric->featured,
            ];
        }

        return response()->json(['data' => $data]);
    }
}
