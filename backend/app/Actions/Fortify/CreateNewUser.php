<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Domain\Billing\Entitlements;
use App\Models\Subscription;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Rules\EmailAvailable;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\CreatesNewUsers;

/**
 * Cadastro: cria usuário + agência + vínculo de dono em uma transação.
 *
 * Os UUIDs são gerados aqui para que o contexto de segurança (tenant e usuário novos)
 * seja definido ANTES dos INSERTs; assim as políticas WITH CHECK do RLS são satisfeitas
 * sem precisar de nenhum caminho que ignore o RLS.
 */
class CreateNewUser implements CreatesNewUsers
{
    use PasswordValidationRules;

    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function create(array $input): User
    {
        /** @var array{name: string, email: string, password: string, company_name: string} $data */
        $data = Validator::make($input, [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', new EmailAvailable],
            'password' => $this->passwordRules(),
            'company_name' => ['required', 'string', 'max:120'],
        ])->validate();

        $userId = (string) Str::uuid7();
        $tenantId = (string) Str::uuid7();

        return $this->context->run($tenantId, $userId, fn (): User => DB::transaction(function () use ($data, $userId, $tenantId): User {
            $user = new User([
                'name' => $data['name'],
                'email' => Str::lower($data['email']),
                'password' => Hash::make($data['password']),
            ]);
            $user->id = $userId;
            $user->save();

            $tenant = Tenant::query()->create([
                'id' => $tenantId,
                'name' => $data['company_name'],
                'slug' => self::slugFor($data['company_name']),
            ]);

            TenantMembership::query()->create([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'role' => TenantRole::Owner,
            ]);

            // Teste grátis com tudo liberado (ADR 0031). Trocar de plano é coisa do sistema.
            Subscription::query()->create(['plan' => 'trial', 'status' => 'trialing', 'trial_ends_at' => now()->addDays(Entitlements::trialDays())]);

            $this->audit->record('tenant.created', $tenant);

            return $user;
        }));
    }

    /**
     * Sufixo aleatório: sob RLS não é possível (nem desejável) consultar slugs de outras
     * agências para garantir unicidade; o índice único do banco é a garantia final.
     */
    private static function slugFor(string $name): string
    {
        $base = Str::limit(Str::slug($name), 40, '') ?: 'agencia';

        return $base.'-'.Str::lower(Str::random(6));
    }
}
