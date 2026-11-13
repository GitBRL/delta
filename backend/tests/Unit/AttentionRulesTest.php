<?php

declare(strict_types=1);

use App\Domain\Insights\ProjectGoals;
use App\Domain\Insights\RuleBook;
use App\Domain\Insights\RuleContext;
use App\Domain\Insights\Rules\ChangeRule;
use App\Domain\Insights\Rules\ThresholdRule;
use App\Domain\Insights\SignalStatus;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;

/** Contexto artificial: janela => métrica => [value, previous, change_pct]. */
function ctx(array $windows, ?ProjectGoals $goals = null): RuleContext
{
    $built = [];
    foreach ($windows as $window => $metrics) {
        foreach ($metrics as $key => [$value, $previous, $change]) {
            $built[$window][$key] = ['value' => $value, 'previous' => $previous, 'change_pct' => $change];
        }
    }

    return new RuleContext($built, $goals ?? new ProjectGoals, new MetricSet(new Catalog));
}

function frequencyRule(): ThresholdRule
{
    return new ThresholdRule('t.freq', 'meta_ads:frequency', above: true, attention: 3.0, critical: 4.0,
        title: 'Público saturando', explanation: 'Frequência {value} (limite {threshold}).', suggestion: 'Renove.',
        window: RuleContext::LAST_7, minVolume: ['meta_ads:impressions' => 1000]);
}

it('classifica por faixa: saudável, atenção e crítico', function (float $frequency, ?SignalStatus $expected) {
    $signal = frequencyRule()->evaluate(ctx([RuleContext::LAST_7 => [
        'meta_ads:frequency' => [$frequency, null, null],
        'meta_ads:impressions' => [5000, null, null],
    ]]));

    expect($signal?->status)->toBe($expected);
})->with([
    [2.5, null],
    [3.0, null],
    [3.4, SignalStatus::Attention],
    [4.6, SignalStatus::Critical],
]);

it('formata o texto em pt-BR com a unidade da métrica', function () {
    $signal = frequencyRule()->evaluate(ctx([RuleContext::LAST_7 => [
        'meta_ads:frequency' => [3.456, null, null],
        'meta_ads:impressions' => [5000, null, null],
    ]]));

    expect($signal?->explanation)->toBe('Frequência 3,46 (limite 3,00).');
});

it('ignora a regra sem volume mínimo (evita alarme com poucos dados)', function () {
    $signal = frequencyRule()->evaluate(ctx([RuleContext::LAST_7 => [
        'meta_ads:frequency' => [9.0, null, null],
        'meta_ads:impressions' => [200, null, null],
    ]]));

    expect($signal)->toBeNull();
});

it('entende "piorar" pela direção da métrica nas regras de variação', function () {
    $rule = new ChangeRule('t.cpm', 'meta_ads:cpm', worseWhenUp: true, attentionPct: 30, criticalPct: 50,
        title: 'CPM subiu', explanation: '{previous} → {value} ({change})', suggestion: '—');

    $up = $rule->evaluate(ctx([RuleContext::PERIOD => ['meta_ads:cpm' => [39.0, 30.0, 30.0]]]));
    $down = $rule->evaluate(ctx([RuleContext::PERIOD => ['meta_ads:cpm' => [21.0, 30.0, -30.0]]]));

    expect($up?->status)->toBe(SignalStatus::Attention)
        ->and($up?->explanation)->toBe("R\$\u{00A0}30,00 → R\$\u{00A0}39,00 (+30,0%)") // espaço não separável do ICU
        ->and($down)->toBeNull();
});

it('calcula o ROAS de equilíbrio pela margem bruta', function () {
    expect((new ProjectGoals(grossMarginPct: 40))->breakEvenRoas())->toEqualWithDelta(2.5, 1e-9)
        ->and((new ProjectGoals)->breakEvenRoas())->toEqualWithDelta(1.0, 1e-9);
});

it('tem regras com ids únicos, só sobre métricas do catálogo', function () {
    $catalog = new Catalog;
    $ids = [];

    foreach (RuleBook::all() as $rule) {
        $ids[] = $rule->id();
        expect($rule->id())->toStartWith($rule->provider().'.');

        foreach ($rule->metrics() as $metric) {
            expect($catalog->metric($metric))->not->toBeNull("{$rule->id()} usa {$metric}");
        }
    }

    expect($ids)->toBe(array_values(array_unique($ids)));
});
