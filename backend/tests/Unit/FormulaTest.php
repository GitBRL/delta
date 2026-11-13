<?php

declare(strict_types=1);

use App\Domain\Metrics\Formula\Formula;
use App\Domain\Metrics\Formula\FormulaException;

it('respeita a precedência dos operadores e os parênteses', function (string $source, float $expected) {
    expect(Formula::parse($source)->evaluate([]))->toEqualWithDelta($expected, 1e-9);
})->with([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 / 4 - 1', 1.5],
    ['-2 * -3', 6],
    ['- (2 + 3)', -5],
    ['2 * 3.5', 7],
]);

it('calcula com referências a métricas', function () {
    $ctr = Formula::parse('meta_ads:link_clicks / meta_ads:impressions * 100');

    expect($ctr->evaluate(['meta_ads:link_clicks' => 150, 'meta_ads:impressions' => 10_000]))->toEqualWithDelta(1.5, 1e-9)
        ->and($ctr->references())->toBe(['meta_ads:link_clicks', 'meta_ads:impressions']);
});

it('devolve nulo na divisão por zero e com operando ausente, em vez de zero ou erro', function () {
    $cpa = Formula::parse('meta_ads:spend / meta_ads:conversions');

    expect($cpa->evaluate(['meta_ads:spend' => 100, 'meta_ads:conversions' => 0]))->toBeNull()
        ->and($cpa->evaluate(['meta_ads:spend' => 100]))->toBeNull()
        ->and($cpa->evaluate(['meta_ads:spend' => null, 'meta_ads:conversions' => 4]))->toBeNull();
});

it('lista cada referência uma vez só', function () {
    expect(Formula::parse('a:x + a:x * b:y')->references())->toBe(['a:x', 'b:y']);
});

it('recusa fórmulas inválidas com mensagem clara', function (string $source, string $message) {
    expect(fn () => Formula::parse($source))->toThrow(FormulaException::class, $message);
})->with([
    ['', 'vazia'],
    ['1 +', 'incompleta'],
    ['(1 + 2', 'parêntese'],
    ['1 + 2)', 'inesperado'],
    ['meta_ads:spend; drop table users', 'Caractere inesperado'],
    ['system("ls")', 'Caractere inesperado'],
    ['$x + 1', 'Caractere inesperado'],
]);

it('limita aninhamento e tamanho para não virar vetor de abuso', function () {
    expect(fn () => Formula::parse(str_repeat('(', 40).'1'.str_repeat(')', 40)))
        ->toThrow(FormulaException::class, 'aninhados demais')
        ->and(fn () => Formula::parse(str_repeat('1 + ', 200).'1'))
        ->toThrow(FormulaException::class, 'longa demais');
});

it('oferece funções que combinam plataformas que nem todo projeto tem', function () {
    $total = Formula::parse('sum(meta_ads:spend, google_ads:cost)');

    expect($total->evaluate(['meta_ads:spend' => 100, 'google_ads:cost' => 50]))->toEqualWithDelta(150, 1e-9)
        ->and($total->evaluate(['meta_ads:spend' => 100]))->toEqualWithDelta(100, 1e-9)
        ->and($total->evaluate([]))->toBeNull()
        ->and($total->references())->toBe(['meta_ads:spend', 'google_ads:cost']);
});

it('calcula min, max, abs, round e coalesce', function (string $source, ?float $expected) {
    $values = ['a:x' => 4.0, 'a:y' => -2.5, 'a:z' => null];
    $result = Formula::parse($source)->evaluate($values);

    $expected === null ? expect($result)->toBeNull() : expect($result)->toEqualWithDelta($expected, 1e-9);
})->with([
    ['min(a:x, a:y, a:z)', -2.5],
    ['max(a:x, a:y, a:z)', 4.0],
    ['abs(a:y)', 2.5],
    ['round(a:x / 3, 2)', 1.33],
    ['round(a:y)', -3.0],
    ['coalesce(a:z, a:x)', 4.0],
    ['abs(a:z)', null],
    ['min(a:z)', null],
]);

it('valida nome e número de argumentos das funções', function (string $source, string $message) {
    expect(fn () => Formula::parse($source))->toThrow(FormulaException::class, $message);
})->with([
    ['media(a:x)', 'Função desconhecida'],
    ['abs(a:x, a:y)', 'abs() recebe 1'],
    ['round(a:x, 1.5)', 'casas precisa ser'],
    ['round(a:x, 9)', 'casas precisa ser'],
    ['sum()', 'ao menos 1'],
    ['sum(a:x', 'Falta fechar o parêntese'],
    ['sum', 'Faltam os parênteses'],
]);
