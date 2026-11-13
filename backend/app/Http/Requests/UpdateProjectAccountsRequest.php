<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class UpdateProjectAccountsRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'account_ids' => ['present', 'array', 'max:50'],
            // exists sob RLS: só passa conta da própria agência.
            'account_ids.*' => ['uuid', 'distinct', Rule::exists('integration_accounts', 'id')],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return ['account_ids.*.exists' => 'Conta não encontrada.'];
    }
}
