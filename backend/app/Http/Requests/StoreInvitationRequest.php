<?php

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Convite para a equipe. Quem pode: middleware "tenant.admin". */
final class StoreInvitationRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $client = $this->input('role') === 'client';

        return [
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'role' => ['required', Rule::in(['admin', 'analyst', 'client'])],
            'project_ids' => [Rule::requiredIf($client), 'nullable', 'array', ...($client ? ['min:1'] : []), 'max:200'],
            'project_ids.*' => ['uuid'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'email.required' => 'Informe o e-mail da pessoa.',
            'email.email' => 'Este e-mail não parece válido.',
            'role.required' => 'Escolha o papel da pessoa na agência.',
            'role.in' => 'Escolha Administrador, Analista ou Cliente.',
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
