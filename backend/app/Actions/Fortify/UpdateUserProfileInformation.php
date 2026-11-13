<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Models\User;
use App\Rules\EmailAvailable;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\UpdatesUserProfileInformation;

class UpdateUserProfileInformation implements UpdatesUserProfileInformation
{
    /**
     * @param  array<string, string>  $input
     *
     * @throws ValidationException
     */
    public function update(User $user, array $input): void
    {
        Validator::make($input, [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', new EmailAvailable($user->id)],
        ])->validateWithBag('updateProfileInformation');

        $email = Str::lower($input['email']);

        if ($email !== $user->email && $user instanceof MustVerifyEmail) {
            $user->forceFill([
                'name' => $input['name'],
                'email' => $email,
                'email_verified_at' => null,
            ])->save();

            $user->sendEmailVerificationNotification();

            return;
        }

        $user->forceFill([
            'name' => $input['name'],
            'email' => $email,
        ])->save();
    }
}
