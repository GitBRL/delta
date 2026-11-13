<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\Requests\Concerns\ValidatesPeriod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
use Illuminate\Validation\Validator;

/** Semáforo de um projeto: leitura, também para o papel cliente. */
final class AttentionRequest extends FormRequest
{
    use ValidatesPeriod;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // A comparação é sempre com o período anterior; o campo não é pedido aqui.
        /** @var array<string, mixed> $rules */
        $rules = Arr::except($this->periodRules(), 'compare');

        return $rules;
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->checkPeriodLength($validator)];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return $this->periodMessages();
    }
}
