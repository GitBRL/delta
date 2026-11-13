<?php

declare(strict_types=1);

use App\Domain\Reports\Pdf\MetricFormat;
use App\Domain\Reports\Pdf\TextBlock;
use App\Domain\Reports\ReportPeriod;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

$today = CarbonImmutable::parse('2026-11-12');

it('resolve os presets até ontem', function (string $preset, string $start, string $end) use ($today) {
    $period = ReportPeriod::resolve($preset, today: $today);

    expect($period->start->toDateString())->toBe($start)->and($period->end->toDateString())->toBe($end);
})->with([
    ['last_7', '2026-11-05', '2026-11-11'],
    ['last_30', '2026-10-13', '2026-11-11'],
    ['last_month', '2026-10-01', '2026-10-31'],
    ['this_month', '2026-11-01', '2026-11-11'],
]);

it('recusa períodos sem dados ou no futuro', function (string $preset, ?string $start, ?string $end, string $field) use ($today) {
    expect(fn () => ReportPeriod::resolve($preset, $start, $end, $preset === 'this_month' ? CarbonImmutable::parse('2026-11-01') : $today))
        ->toThrow(ValidationException::class);

    try {
        ReportPeriod::resolve($preset, $start, $end, $preset === 'this_month' ? CarbonImmutable::parse('2026-11-01') : $today);
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKey($field);
    }
})->with([
    ['this_month', null, null, 'period_preset'],
    ['custom', null, null, 'period_preset'],
    ['custom', '2026-11-01', '2026-11-12', 'period_end'],
    ['custom', '2026-11-10', '2026-11-01', 'period_end'],
    ['custom', '2025-01-01', '2026-11-01', 'period_end'],
]);

it('formata como o design system', function () {
    expect(MetricFormat::value(1234.5, 'currency'))->toBe('R$ 1.234,50')
        ->and(MetricFormat::value(2_400_000, 'currency'))->toBe('R$ 2,4 mi')
        ->and(MetricFormat::value(3.456, 'percent'))->toBe('3,5%')
        ->and(MetricFormat::value(48_210, 'count'))->toBe('48,2 mil')
        ->and(MetricFormat::value(12_000, 'count'))->toBe('12 mil')
        ->and(MetricFormat::value(4.1, 'decimal'))->toBe('4,10')
        ->and(MetricFormat::value(125, 'duration'))->toBe('2 min 05 s')
        ->and(MetricFormat::value(null, 'count'))->toBe('—')
        ->and(MetricFormat::change(12.5))->toBe('▲ 12,5%')
        ->and(MetricFormat::change(-6))->toBe('▼ 6,0%');
});

it('converte o texto da análise em HTML seguro', function () {
    expect(TextBlock::toHtml("**Bom** <b>x</b>\nlinha\n\n- a\n- b"))
        ->toBe('<p><strong>Bom</strong> &lt;b&gt;x&lt;/b&gt;<br>linha</p><ul><li>a</li><li>b</li></ul>');
});
