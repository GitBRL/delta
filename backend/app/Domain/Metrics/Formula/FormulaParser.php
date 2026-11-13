<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Formula;

/** Parser descendente recursivo para Formula. Uso interno. */
final class FormulaParser
{
    private int $position = 0;

    /** @param list<array{0: string, 1: string, 2: int}> $tokens */
    public function __construct(
        private readonly array $tokens,
        private readonly int $maxDepth,
    ) {}

    /** @return array<string, mixed> */
    public function parse(): array
    {
        $ast = $this->expression(0);

        if ($this->position < count($this->tokens)) {
            throw new FormulaException(sprintf('Trecho inesperado "%s" na posição %d.', $this->tokens[$this->position][1], $this->tokens[$this->position][2] + 1));
        }

        return $ast;
    }

    /** @return array<string, mixed> */
    private function expression(int $depth): array
    {
        $node = $this->term($depth);

        while ($this->peekOp('+') || $this->peekOp('-')) {
            $op = $this->tokens[$this->position++][1];
            $node = ['type' => 'bin', 'op' => $op, 'left' => $node, 'right' => $this->term($depth)];
        }

        return $node;
    }

    /** @return array<string, mixed> */
    private function term(int $depth): array
    {
        $node = $this->unary($depth);

        while ($this->peekOp('*') || $this->peekOp('/')) {
            $op = $this->tokens[$this->position++][1];
            $node = ['type' => 'bin', 'op' => $op, 'left' => $node, 'right' => $this->unary($depth)];
        }

        return $node;
    }

    /** @return array<string, mixed> */
    private function unary(int $depth): array
    {
        if ($depth > $this->maxDepth) {
            throw new FormulaException('A fórmula tem parênteses ou sinais aninhados demais.');
        }

        if ($this->peekOp('-')) {
            $this->position++;

            return ['type' => 'neg', 'operand' => $this->unary($depth + 1)];
        }

        return $this->primary($depth);
    }

    /** @return array<string, mixed> */
    private function primary(int $depth): array
    {
        $token = $this->tokens[$this->position] ?? null;

        if ($token === null) {
            throw new FormulaException('A fórmula termina de forma incompleta.');
        }

        [$type, $text, $at] = $token;
        $this->position++;

        if ($type === 'num') {
            return ['type' => 'num', 'value' => (float) $text];
        }

        if ($type === 'ref') {
            return ['type' => 'ref', 'key' => $text];
        }

        if ($type === 'fn') {
            return $this->call($text, $at, $depth);
        }

        if ($text === '(') {
            $node = $this->expression($depth + 1);

            if (! $this->peekOp(')')) {
                throw new FormulaException('Falta fechar um parêntese.');
            }

            $this->position++;

            return $node;
        }

        throw new FormulaException(sprintf('"%s" inesperado na posição %d.', $text, $at + 1));
    }

    /** @return array<string, mixed> */
    private function call(string $name, int $at, int $depth): array
    {
        $arity = Formula::FUNCTIONS[$name] ?? throw new FormulaException(sprintf(
            'Função desconhecida "%s" na posição %d. Disponíveis: %s.',
            $name,
            $at + 1,
            implode(', ', array_keys(Formula::FUNCTIONS)),
        ));

        if (! $this->peekOp('(')) {
            throw new FormulaException("Faltam os parênteses de {$name}(...).");
        }
        $this->position++;

        $args = [];
        if (! $this->peekOp(')')) {
            $args[] = $this->expression($depth + 1);
            while ($this->peekOp(',')) {
                $this->position++;
                $args[] = $this->expression($depth + 1);
            }
        }

        if (! $this->peekOp(')')) {
            throw new FormulaException("Falta fechar o parêntese de {$name}(...).");
        }
        $this->position++;

        [$min, $max] = $arity;
        if (count($args) < $min || ($max !== null && count($args) > $max)) {
            $expected = $max === null ? "ao menos {$min}" : ($min === $max ? (string) $min : "{$min} a {$max}");
            throw new FormulaException("{$name}() recebe {$expected} argumento(s).");
        }

        if ($name === 'round' && isset($args[1])) {
            $digits = $args[1];
            if ($digits['type'] !== 'num' || ! in_array($digits['value'], [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0], true)) {
                throw new FormulaException('round(x, casas): casas precisa ser um número inteiro de 0 a 6.');
            }
        }

        return ['type' => 'call', 'name' => $name, 'args' => $args];
    }

    private function peekOp(string $op): bool
    {
        $token = $this->tokens[$this->position] ?? null;

        return $token !== null && $token[0] === 'op' && $token[1] === $op;
    }
}
