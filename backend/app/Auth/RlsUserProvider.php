<?php

declare(strict_types=1);

namespace App\Auth;

use App\Support\Tenancy\AuthIdentifier;
use App\Support\Tenancy\TenantContext;
use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable as UserContract;
use Illuminate\Contracts\Hashing\Hasher as HasherContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Provider de usuários compatível com RLS.
 *
 * A tabela users só é visível com contexto (próprio usuário ou colegas do tenant). Login,
 * restauração de sessão, "lembrar-me" e reset de senha precisam achar o usuário antes disso,
 * então as buscas passam por funções SECURITY DEFINER estreitas (busca exata por id ou e-mail).
 *
 * O contexto de usuário só é definido depois que a identidade foi comprovada:
 * sessão válida (retrieveById), token "lembrar-me" conferido ou senha validada.
 */
final class RlsUserProvider extends EloquentUserProvider
{
    public function __construct(
        HasherContract $hasher,
        string $model,
        private readonly TenantContext $context,
    ) {
        parent::__construct($hasher, $model);
    }

    /** @return (UserContract&Model)|null */
    public function retrieveById($identifier): ?UserContract
    {
        $user = $this->findById($identifier);

        if ($user !== null) {
            $this->context->setUser(AuthIdentifier::of($user));
        }

        return $user;
    }

    /** @return (UserContract&Model)|null */
    public function retrieveByToken($identifier, #[\SensitiveParameter] $token): ?UserContract
    {
        $user = $this->findById($identifier);

        if ($user === null || $token === '') {
            return null;
        }

        $rememberToken = $user->getRememberToken();

        if (! is_string($rememberToken) || ! hash_equals($rememberToken, $token)) {
            return null;
        }

        $this->context->setUser(AuthIdentifier::of($user));

        return $user;
    }

    /**
     * @param  array<string, mixed>  $credentials
     * @return (UserContract&Model)|null
     */
    public function retrieveByCredentials(#[\SensitiveParameter] array $credentials): ?UserContract
    {
        $email = $credentials['email'] ?? null;

        if (! is_string($email) || $email === '') {
            return null;
        }

        return $this->hydrateFirst('select * from app.auth_user_by_email(?)', [$email]);
    }

    /** @param array<string, mixed> $credentials */
    public function validateCredentials(UserContract $user, #[\SensitiveParameter] array $credentials): bool
    {
        $valid = parent::validateCredentials($user, $credentials);

        if ($valid) {
            $this->context->setUser(AuthIdentifier::of($user));
        }

        return $valid;
    }

    public function updateRememberToken(UserContract $user, #[\SensitiveParameter] $token): void
    {
        $this->context->setUser(AuthIdentifier::of($user));

        parent::updateRememberToken($user, $token);
    }

    /** @param array<string, mixed> $credentials */
    public function rehashPasswordIfRequired(UserContract $user, #[\SensitiveParameter] array $credentials, bool $force = false): void
    {
        $this->context->setUser(AuthIdentifier::of($user));

        parent::rehashPasswordIfRequired($user, $credentials, $force);
    }

    /** @return (UserContract&Model)|null */
    private function findById(mixed $identifier): ?UserContract
    {
        if (! is_string($identifier) || ! Str::isUuid($identifier)) {
            return null;
        }

        return $this->hydrateFirst('select * from app.auth_user_by_id(?)', [$identifier]);
    }

    /**
     * @param  list<mixed>  $bindings
     * @return (UserContract&Model)|null
     */
    private function hydrateFirst(string $sql, array $bindings): ?UserContract
    {
        /** @var Model&UserContract $model */
        $model = $this->createModel();
        $rows = $model->getConnection()->select($sql, $bindings);

        if ($rows === []) {
            return null;
        }

        /** @var array<string, mixed> $attributes */
        $attributes = (array) $rows[0];

        /** @var Model&UserContract $user */
        $user = $model->newFromBuilder($attributes);

        return $user;
    }
}
