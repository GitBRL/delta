<?php

declare(strict_types=1);

namespace App\Http\Requests\Concerns;

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Metrics\Query\Comparison;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/** Regras comuns de período (início, fim, comparação) das consultas de métricas. */
trait ValidatesPeriod
{
    public const MAX_DAYS = 400;

    /** @return array<string, mixed> */
    protected function periodRules(): array
    {
        $today = CarbonImmutable::now(ConnectionManager::timezone())->toDateString();

        return [
            'start' => ['required', 'date_format:Y-m-d'],
            'end' => ['required', 'date_format:Y-m-d', 'after_or_equal:start', 'before_or_equal:'.$today],
            'compare' => ['required', Rule::enum(Comparison::class)],
        ];
    }

    protected function checkPeriodLength(Validator $validator): void
    {
        if ($validator->errors()->hasAny(['start', 'end'])) {
            return;
        }

        $days = CarbonImmutable::parse($this->string('start')->toString())
            ->diffInDays(CarbonImmutable::parse($this->string('end')->toString())) + 1;

        if ($days > self::MAX_DAYS) {
            $validator->errors()->add('end', 'O período pode ter no máximo '.self::MAX_DAYS.' dias.');
        }
    }

    /** @return array<string, string> */
    protected function periodMessages(): array
    {
        return ['end.before_or_equal' => 'O período não pode terminar no futuro.'];
    }
}
