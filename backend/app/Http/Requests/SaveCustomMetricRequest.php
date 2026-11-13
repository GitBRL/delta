<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Metrics\Catalog\MetricDirection;
use App\Domain\Metrics\Catalog\MetricUnit;
use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Criação e edição de indicador. A validação da fórmula (sintaxe, referências, ciclos) é do controller. */
final class SaveCustomMetricRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'description' => ['nullable', 'string', 'max:500'],
            'formula' => ['required', 'string', 'max:500'],
            'unit' => ['required', Rule::enum(MetricUnit::class)],
            'direction' => ['required', Rule::enum(MetricDirection::class)],
            'decimals' => ['required', 'integer', 'min:0', 'max:6'],
        ];
    }
}
