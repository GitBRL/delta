<?php

declare(strict_types=1);

namespace App\Domain\Insights\Rules;

use App\Domain\Insights\Rule;
use App\Domain\Insights\RuleContext;
use App\Domain\Insights\Signal;
use Closure;

/** Regra com lógica própria (metas do projeto, qualidade dos dados). */
final readonly class CallbackRule implements Rule
{
    /**
     * @param  list<string>  $metrics
     * @param  Closure(RuleContext, string): ?Signal  $check  recebe o contexto e o id da regra
     */
    public function __construct(
        private string $id,
        private string $provider,
        private array $metrics,
        private Closure $check,
    ) {}

    public function id(): string
    {
        return $this->id;
    }

    public function provider(): string
    {
        return $this->provider;
    }

    public function metrics(): array
    {
        return $this->metrics;
    }

    public function evaluate(RuleContext $context): ?Signal
    {
        return ($this->check)($context, $this->id);
    }
}
