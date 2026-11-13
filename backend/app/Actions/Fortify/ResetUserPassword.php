<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

/**
 * Reset de senha. Chega aqui só depois de o broker validar o token enviado por e-mail;
 * por isso é seguro colocar o usuário no contexto para a política de UPDATE de users.
 */
class ResetUserPassword implements ResetsUserPasswords
{
    use PasswordValidationRules;

    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  array<string, string>  $input
     *
     * @throws ValidationException
     */
    public function reset(User $user, array $input): void
    {
        Validator::make($input, [
            'password' => $this->passwordRules(),
        ])->validate();

        $this->context->run(null, $user->id, function () use ($user, $input): void {
            $user->forceFill([
                'password' => Hash::make($input['password']),
            ])->save();
        });
    }
}
