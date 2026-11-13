<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RequiresStaff;
use Illuminate\Foundation\Http\FormRequest;

final class SyncConnectionRequest extends FormRequest
{
    use RequiresStaff;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [];
    }
}
