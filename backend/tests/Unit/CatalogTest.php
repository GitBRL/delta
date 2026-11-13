<?php

declare(strict_types=1);

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricKind;
use App\Domain\Metrics\Formula\FormulaException;
use App\Domain\Metrics\Query\Comparison;
use Carbon\CarbonImmutable;

/*
| Guarda do catálogo: erros aqui viram números errados nos relatórios de todos os clientes.
*/

it('tem os 10 canais (5 do MVP + Search Console, YouTube, Perfil da Empresa, TikTok Ads e LinkedIn Ads)', function () {
    expect(array_keys((new Catalog)->providers()))
        ->toBe(['meta_ads', 'google_ads', 'ga4', 'instagram', 'facebook', 'search_console', 'youtube', 'google_business', 'tiktok_ads', 'linkedin_ads']);
});

it('usa chaves no formato plataforma:métrica, da própria plataforma', function () {
    foreach ((new Catalog)->providers() as $provider) {
        foreach ($provider->metrics() as $metric) {
            expect($metric->key)->toMatch('/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/')
                ->and($metric->provider())->toBe($provider->key());
        }
    }
});

it('tem fórmulas válidas, que só usam métricas existentes da mesma plataforma', function () {
    $catalog = new Catalog;

    foreach ($catalog->metrics() as $metric) {
        if ($metric->kind !== MetricKind::Derived) {
            expect($metric->formula)->toBeNull();

            continue;
        }

        foreach ($catalog->formula($metric)->references() as $ref) {
            expect($catalog->metric($ref))->not->toBeNull("{$metric->key} usa {$ref}, que não existe")
                ->and(explode(':', $ref)[0])->toBe($metric->provider());
        }
    }
});

it('resolve as métricas armazenadas necessárias para as derivadas', function () {
    expect((new Catalog)->baseMetricsFor(['meta_ads:roas', 'meta_ads:ctr', 'meta_ads:spend']))
        ->toEqualCanonicalizing(['meta_ads:conversion_value', 'meta_ads:spend', 'meta_ads:link_clicks', 'meta_ads:impressions']);
});

it('recusa métrica desconhecida', function () {
    (new Catalog)->baseMetricsFor(['meta_ads:inexistente']);
})->throws(FormulaException::class, 'desconhecid');

it('destaca ao menos uma métrica visível por canal', function () {
    foreach ((new Catalog)->providers() as $provider) {
        $featured = array_filter($provider->metrics(), fn ($m) => $m->featured && $m->visible);
        expect($featured)->not->toBeEmpty("{$provider->key()} sem métricas em destaque");
    }
});

it('classifica a tendência pela direção da métrica', function (MetricDirection $direction, ?float $change, string $sentiment) {
    expect($direction->sentiment($change))->toBe($sentiment);
})->with([
    [MetricDirection::HigherIsBetter, 12.0, 'positive'],
    [MetricDirection::HigherIsBetter, -12.0, 'negative'],
    [MetricDirection::LowerIsBetter, -8.0, 'positive'],
    [MetricDirection::LowerIsBetter, 8.0, 'negative'],
    [MetricDirection::Neutral, 30.0, 'neutral'],
    [MetricDirection::HigherIsBetter, 0.2, 'neutral'],
    [MetricDirection::HigherIsBetter, null, 'neutral'],
]);

it('calcula os períodos de comparação', function () {
    $start = CarbonImmutable::parse('2026-10-01');
    $end = CarbonImmutable::parse('2026-10-31');

    [$ps, $pe] = Comparison::PreviousPeriod->shift($start, $end);
    [$ys, $ye] = Comparison::PreviousYear->shift(CarbonImmutable::parse('2024-02-29'), CarbonImmutable::parse('2024-03-06'));

    expect([$ps->toDateString(), $pe->toDateString()])->toBe(['2026-08-31', '2026-09-30'])
        ->and([$ys->toDateString(), $ye->toDateString()])->toBe(['2023-02-28', '2023-03-06'])
        ->and(Comparison::None->shift($start, $end))->toBeNull();
});
