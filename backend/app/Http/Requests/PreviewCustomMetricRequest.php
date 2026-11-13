<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Http\Requests\Concerns\RequiresStaff;
use App\Http\Requests\Concerns\ValidatesPeriod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class PreviewCustomMetricRequest extends FormRequest
{
    use RequiresStaff, ValidatesPeriod;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...$this->periodRules(),
            'formula' => ['required', 'string', 'max:500'],
            'unit' => ['required', Rule::enum(MetricUnit::class)],
            'direction' => ['required', Rule::enum(MetricDirection::class)],
            'decimals' => ['required', 'integer', 'min:0', 'max:6'],
            // exists sob RLS: só projeto da própria agência.
            'project_id' => ['required', 'uuid', Rule::exists('projects', 'id')],
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
        return [...$this->periodMessages(), 'project_id.exists' => 'Projeto não encontrado.'];
    }
}
