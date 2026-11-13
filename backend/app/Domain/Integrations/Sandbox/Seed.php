<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Sandbox;

use Carbon\CarbonImmutable;

/**
 * Pseudoaleatoriedade determinística: o mesmo (conta, data, rótulo) gera sempre o mesmo número.
 * Assim os dados de demonstração são estáveis entre sincronizações e reproduzíveis em testes.
 */
final readonly class Seed
{
    public function __construct(private string $account) {}

    /** Número em [0, 1) fixo para a conta (perfil da conta: tamanho, CTR típico...). */
    public function trait(string $label): float
    {
        return self::unit($this->account.'|'.$label);
    }

    /** Número em [0, 1) para a conta em um dia. */
    public function daily(string $label, CarbonImmutable $date): float
    {
        return self::unit($this->account.'|'.$label.'|'.$date->toDateString());
    }

    /** Fator multiplicativo em torno de 1 (± $spread) para a conta em um dia. */
    public function noise(string $label, CarbonImmutable $date, float $spread): float
    {
        return 1 + ($this->daily($label, $date) * 2 - 1) * $spread;
    }

    private static function unit(string $input): float
    {
        // 13 dígitos hexadecimais = 52 bits, cabem com precisão em um float.
        return hexdec(substr(hash('xxh64', $input), 0, 13)) / 0x10000000000000;
    }
}
