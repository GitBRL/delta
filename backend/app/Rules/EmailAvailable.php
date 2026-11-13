<?php

declare(strict_types=1);

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Facades\DB;

/**
 * Unicidade de e-mail compatível com RLS. A regra "unique:users" do Laravel faria um SELECT
 * que, sob RLS, não enxerga usuários de outras agências e aprovaria e-mails duplicados.
 */
final readonly class EmailAvailable implements ValidationRule
{
    public function __construct(private ?string $exceptUserId = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return;
        }

        $taken = DB::scalar('select app.email_taken(?, ?)', [$value, $this->exceptUserId]);

        if ($taken === true) {
            $fail('Este e-mail já está em uso.');
        }
    }
}
