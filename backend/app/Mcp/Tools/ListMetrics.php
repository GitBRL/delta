<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Controllers\Api\V1\MetricCatalogController;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('list_metrics')]
#[IsReadOnly]
#[Description('Catálogo de métricas disponíveis (dos canais e indicadores personalizados da agência), com chave, unidade e se maior é melhor. Filtre por canal ou texto para respostas menores.')]
final class ListMetrics extends DeltaTool
{
    protected function scope(): string
    {
        return 'metrics:read';
    }

    public function handle(Request $request): Response
    {
        $provider = $request->get('provider');
        $search = $request->get('search');
        $metrics = self::data(app(MetricCatalogController::class)(app(Catalog::class)));

        $filtered = array_values(array_filter(is_array($metrics) ? $metrics : [], function (mixed $m) use ($provider, $search): bool {
            if (! is_array($m)) {
                return false;
            }
            if (is_string($provider) && $provider !== '' && ($m['provider'] ?? null) !== $provider) {
                return false;
            }
            if (is_string($search) && $search !== '') {
                $haystack = mb_strtolower(implode(' ', array_filter([$m['key'] ?? '', $m['label'] ?? '', $m['description'] ?? ''], 'is_string')));

                return str_contains($haystack, mb_strtolower($search));
            }

            return true;
        }));

        return Response::json($filtered);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'provider' => $schema->string()->description('Canal, ex.: meta_ads, google_ads, ga4, instagram, facebook, search_console, youtube, google_business, tiktok_ads, linkedin_ads, custom, manual.'),
            'search' => $schema->string()->description('Texto para filtrar por chave, nome ou descrição (ex.: "cpa", "conversão").'),
        ];
    }
}
