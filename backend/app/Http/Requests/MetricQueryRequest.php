<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Http\Requests\Concerns\ValidatesPeriod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/** Consulta de métricas: leitura, permitida também ao papel cliente (nos projetos que ele vê). */
final class MetricQueryRequest extends FormRequest
{
    use ValidatesPeriod;

    public const MAX_METRICS = 40;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(Catalog $catalog): array
    {
        return [
            ...$this->periodRules(),
            'metrics' => ['required', 'array', 'min:1', 'max:'.self::MAX_METRICS],
            'metrics.*' => ['required', 'string', 'distinct', Rule::in(MetricSet::forCurrentTenant($catalog)->keys())],
            'series' => ['sometimes', 'boolean'],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->checkPeriodLength($validator)];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            ...$this->periodMessages(),
            'metrics.*.in' => 'Métrica desconhecida.',
            'metrics.max' => 'Selecione no máximo '.self::MAX_METRICS.' métricas.',
        ];
    }
}
