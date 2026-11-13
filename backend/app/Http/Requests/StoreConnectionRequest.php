<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Domain\Metrics\Catalog\Catalog;
use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class StoreConnectionRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(Catalog $catalog): array
    {
        return [
            'provider' => ['required', 'string', Rule::in(array_keys($catalog->providers()))],
            'mode' => ['required', 'string', Rule::in(['sandbox', 'live'])],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->input('mode') === 'live') {
                    $validator->errors()->add('mode', 'A conexão real com esta plataforma ainda não está disponível: aguardando aprovação da plataforma. Use o modo demonstração.');
                }
            },
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['provider.in' => 'Plataforma desconhecida.'];
    }
}
