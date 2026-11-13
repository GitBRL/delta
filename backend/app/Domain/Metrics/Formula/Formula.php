<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Formula;

/**
 * Fórmula compilada para AST. Base das métricas derivadas do catálogo e, depois, dos
 * indicadores personalizados (§7.1 do plano).
 *
 * Gramática (sem eval, sem acesso a nada além dos valores informados):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := '-' unary | primary
 *   primary := NUMBER | METRIC | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
 *   METRIC  := provedor ':' nome   (ex.: meta_ads:link_clicks, custom:roas_combinado)
 *   FUNC    := sum | min | max | abs | round | coalesce
 *
 * Semântica: qualquer operando nulo torna o resultado nulo; divisão por zero dá nulo
 * (um indicador sem base de cálculo não é zero, é "sem dado"). Exceções deliberadas:
 * sum/min/max ignoram ausentes (nulo só se todos faltarem) e coalesce devolve o primeiro
 * presente, para combinar plataformas que nem todo projeto tem.
 */
final readonly class Formula
{
    private const MAX_LENGTH = 500;

    private const MAX_DEPTH = 32;

    /** Funções permitidas => [mínimo, máximo (null = sem limite)] de argumentos. */
    public const FUNCTIONS = [
        'sum' => [1, null],
        'min' => [1, null],
        'max' => [1, null],
        'abs' => [1, 1],
        'round' => [1, 2],
        'coalesce' => [1, null],
    ];

    /** @param array<string, mixed> $ast */
    private function __construct(
        public string $source,
        public array $ast,
    ) {}

    public static function parse(string $source): self
    {
        $source = trim($source);

        if ($source === '') {
            throw new FormulaException('A fórmula está vazia.');
        }

        if (mb_strlen($source) > self::MAX_LENGTH) {
            throw new FormulaException('A fórmula é longa demais (máximo de '.self::MAX_LENGTH.' caracteres).');
        }

        $parser = new FormulaParser(self::tokenize($source), self::MAX_DEPTH);

        return new self($source, $parser->parse());
    }

    /** @return list<string> métricas referenciadas, sem repetição, na ordem em que aparecem */
    public function references(): array
    {
        $refs = [];
        self::collect($this->ast, $refs);

        return array_values(array_unique($refs));
    }

    /** @param array<string, float|int|null> $values */
    public function evaluate(array $values): ?float
    {
        return self::eval($this->ast, $values);
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, float|int|null>  $values
     */
    private static function eval(array $node, array $values): ?float
    {
        switch ($node['type']) {
            case 'num':
                return self::float($node['value']);

            case 'ref':
                $key = self::string($node['key']);
                $value = $values[$key] ?? null;

                return $value === null ? null : (float) $value;

            case 'neg':
                $operand = self::eval(self::node($node['operand']), $values);

                return $operand === null ? null : -$operand;

            case 'bin':
                $left = self::eval(self::node($node['left']), $values);
                $right = self::eval(self::node($node['right']), $values);

                if ($left === null || $right === null) {
                    return null;
                }

                return match ($node['op']) {
                    '+' => $left + $right,
                    '-' => $left - $right,
                    '*' => $left * $right,
                    '/' => $right == 0.0 ? null : $left / $right,
                    default => throw new FormulaException('Operador desconhecido.'),
                };

            case 'call':
                return self::call(self::string($node['name']), self::nodes($node['args']), $values);
        }

        throw new FormulaException('Nó de fórmula desconhecido.');
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $refs
     */
    private static function collect(array $node, array &$refs): void
    {
        if ($node['type'] === 'ref') {
            $refs[] = self::string($node['key']);
        } elseif ($node['type'] === 'neg') {
            self::collect(self::node($node['operand']), $refs);
        } elseif ($node['type'] === 'bin') {
            self::collect(self::node($node['left']), $refs);
            self::collect(self::node($node['right']), $refs);
        } elseif ($node['type'] === 'call') {
            foreach (self::nodes($node['args']) as $arg) {
                self::collect($arg, $refs);
            }
        }
    }

    /**
     * @param  list<array<string, mixed>>  $args
     * @param  array<string, float|int|null>  $values
     */
    private static function call(string $name, array $args, array $values): ?float
    {
        $evaluated = array_map(fn (array $arg): ?float => self::eval($arg, $values), $args);
        $present = array_values(array_filter($evaluated, fn (?float $v): bool => $v !== null));

        return match ($name) {
            'sum' => $present === [] ? null : array_sum($present),
            'min' => $present === [] ? null : min($present),
            'max' => $present === [] ? null : max($present),
            'coalesce' => $present[0] ?? null,
            'abs' => $evaluated[0] === null ? null : abs($evaluated[0]),
            'round' => $evaluated[0] === null ? null : round($evaluated[0], (int) ($evaluated[1] ?? 0)),
            default => throw new FormulaException("Função desconhecida: {$name}."),
        };
    }

    /** @return list<array{0: string, 1: string, 2: int}> [tipo, texto, posição] */
    private static function tokenize(string $source): array
    {
        $tokens = [];
        $length = strlen($source);
        $i = 0;

        while ($i < $length) {
            $char = $source[$i];

            if (ctype_space($char)) {
                $i++;

                continue;
            }

            if (str_contains('+-*/(),', $char)) {
                $tokens[] = ['op', $char, $i];
                $i++;

                continue;
            }

            if (preg_match('/\G\d+(?:\.\d+)?/', $source, $m, 0, $i) === 1) {
                $tokens[] = ['num', $m[0], $i];
                $i += strlen($m[0]);

                continue;
            }

            if (preg_match('/\G[a-z][a-z0-9_]*:[a-z][a-z0-9_]*/', $source, $m, 0, $i) === 1) {
                $tokens[] = ['ref', $m[0], $i];
                $i += strlen($m[0]);

                continue;
            }

            if (preg_match('/\G[a-z][a-z0-9_]*/', $source, $m, 0, $i) === 1) {
                $tokens[] = ['fn', $m[0], $i];
                $i += strlen($m[0]);

                continue;
            }

            throw new FormulaException(sprintf('Caractere inesperado "%s" na posição %d.', $char, $i + 1));
        }

        return $tokens;
    }

    private static function float(mixed $value): float
    {
        return is_float($value) || is_int($value) ? (float) $value : throw new FormulaException('Número inválido.');
    }

    private static function string(mixed $value): string
    {
        return is_string($value) ? $value : throw new FormulaException('Referência inválida.');
    }

    /** @return list<array<string, mixed>> */
    private static function nodes(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new FormulaException('Fórmula corrompida.');
        }

        return array_map(self::node(...), $value);
    }

    /** @return array<string, mixed> */
    private static function node(mixed $value): array
    {
        if (! is_array($value)) {
            throw new FormulaException('Fórmula corrompida.');
        }

        /** @var array<string, mixed> $value */
        return $value;
    }
}
