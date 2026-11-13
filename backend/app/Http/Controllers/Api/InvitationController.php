<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Actions\Fortify\PasswordValidationRules;
use App\Domain\Team\Invitations;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Página pública do convite: prévia e aceite. Quem chega aqui ainda não é membro da agência,
 * então nada é lido sob o contexto dela: as funções app.invitation_preview e
 * app.accept_invitation fazem a busca exata pelo hash do token (ADR 0010).
 */
final class InvitationController extends Controller
{
    use PasswordValidationRules;

    public function __construct(
        private readonly Invitations $invitations,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function show(string $token): JsonResponse
    {
        $preview = $this->invitations->preview($token) ?? abort(404, 'Convite não encontrado. Confira o link ou peça um novo convite.');

        return response()->json(['data' => [
            'tenant_name' => $preview->tenantName,
            'email' => $preview->email,
            'role' => $preview->role->value,
            'inviter_name' => $preview->inviterName,
            'expires_at' => $preview->expiresAt->toIso8601String(),
            'status' => $preview->status,
            'account_exists' => DB::scalar('select app.email_taken(?)', [$preview->email]) === true,
        ]]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $preview = $this->invitations->preview($token) ?? abort(404, 'Convite não encontrado. Confira o link ou peça um novo convite.');
        abort_if($preview->status !== 'pending', 410, $preview->unavailableMessage());

        $user = $request->user();
        $created = false;

        if ($user instanceof User) {
            abort_if(
                Str::lower($user->email) !== Str::lower($preview->email),
                403,
                "Este convite é para {$preview->email}. Saia e entre com essa conta para aceitar.",
            );
            $tenantId = $this->invitations->accept($token, $user) ?? abort(410, 'Este convite não está mais disponível.');
        } else {
            abort_if(
                DB::scalar('select app.email_taken(?)', [$preview->email]) === true,
                409,
                'Já existe uma conta com este e-mail. Entre para aceitar o convite.',
            );

            /** @var array{name: string, password: string} $data */
            $data = $request->validate([
                'name' => ['required', 'string', 'max:255'],
                'password' => $this->passwordRules(),
            ]);

            [$user, $tenantId] = $this->register($token, $preview->email, $data);
            $created = true;

            Auth::guard('web')->login($user);
            if ($request->hasSession()) {
                $request->session()->regenerate();
            }
        }

        $this->context->run($tenantId, $user->id, fn () => $this->audit->record('invitation.accepted', null, [
            'role' => $preview->role->value,
            'new_account' => $created,
        ]));

        return response()->json(['data' => ['tenant_id' => $tenantId, 'tenant_name' => $preview->tenantName]], $created ? 201 : 200);
    }

    /**
     * Conta nova com o e-mail do convite (o e-mail fica verificado: o link chegou nele) e aceite,
     * na mesma transação: se o convite não valer mais, a conta também não fica.
     *
     * @param  array{name: string, password: string}  $data
     * @return array{0: User, 1: string}
     */
    private function register(string $token, string $email, array $data): array
    {
        $userId = (string) Str::uuid7();

        try {
            return DB::transaction(function () use ($token, $email, $data, $userId): array {
                $user = $this->context->run(null, $userId, function () use ($email, $data, $userId): User {
                    $user = new User(['name' => $data['name'], 'email' => Str::lower($email), 'password' => Hash::make($data['password'])]);
                    $user->id = $userId;
                    $user->forceFill(['email_verified_at' => now()]);
                    $user->save();

                    return $user;
                });

                $tenantId = $this->invitations->accept($token, $user) ?? throw new RuntimeException('convite indisponível');

                return [$user, $tenantId];
            });
        } catch (RuntimeException) {
            abort(410, 'Este convite não está mais disponível.');
        }
    }
}
