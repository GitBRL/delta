<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\TenantMembership;
use Illuminate\Foundation\Http\FormRequest;

final class StoreProjectRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->attributes->get('membership');

        return $membership instanceof TenantMembership && $membership->role->canManageProjects();
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'niche' => ['nullable', 'string', 'max:60'],
        ];
    }
}
