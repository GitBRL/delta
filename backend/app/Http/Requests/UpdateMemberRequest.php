<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Support\Tenancy\TenantRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Mudança de papel de um membro. Quem pode: middleware "tenant.admin" (regras de dono no TeamMembers). */
final class UpdateMemberRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $client = $this->input('role') === TenantRole::Client->value;

        return [
            'role' => ['required', Rule::enum(TenantRole::class)],
            'project_ids' => [Rule::requiredIf($client), 'nullable', 'array', ...($client ? ['min:1'] : []), 'max:200'],
            'project_ids.*' => ['uuid'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'role.required' => 'Escolha o papel.',
            'project_ids.required' => 'Escolha ao menos um projeto para o cliente.',
            'project_ids.min' => 'Escolha ao menos um projeto para o cliente.',
        ];
    }

    /** @return list<string> */
    public function projectIds(): array
    {
        $ids = $this->input('project_ids');

        return is_array($ids) ? array_values(array_filter($ids, 'is_string')) : [];
    }
}
