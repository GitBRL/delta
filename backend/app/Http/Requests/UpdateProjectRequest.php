<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;

/** Dados e perfil de negócio do projeto (calibra o semáforo de atenção). */
final class UpdateProjectRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'min:2', 'max:120'],
            'niche' => ['sometimes', 'nullable', 'string', 'max:60'],
            'goals' => ['sometimes', 'array:gross_margin_pct,target_cpa,target_roas'],
            'goals.gross_margin_pct' => ['nullable', 'numeric', 'gt:0', 'max:100'],
            'goals.target_cpa' => ['nullable', 'numeric', 'gt:0', 'max:1000000'],
            'goals.target_roas' => ['nullable', 'numeric', 'gt:0', 'max:1000'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'goals.gross_margin_pct.max' => 'A margem bruta vai de 0 a 100%.',
            'goals.gross_margin_pct.gt' => 'A margem bruta precisa ser maior que zero.',
        ];
    }
}
