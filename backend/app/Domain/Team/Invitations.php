<?php

declare(strict_types=1);

namespace App\Domain\Team;

use App\Mail\InvitationMail;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\Tenant;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Convites para a equipe da agência (ADR 0010).
 *
 * O token (48 caracteres aleatórios) só existe no link enviado; o banco guarda o sha256.
 * Criar, reenviar e revogar acontecem no contexto da agência (RLS: só dono/admin).
 * Prévia e aceite acontecem antes de a pessoa ser membro: funções estreitas no banco.
 */
final readonly class Invitations
{
    public const TTL_DAYS = 7;

    public function __construct(private TenantContext $context) {}

    /**
     * @param  list<string>  $projectIds
     * @return array{0: Invitation, 1: string} convite e link (o link só existe agora)
     */
    public function invite(string $email, TenantRole $role, array $projectIds): array
    {
        $email = Str::lower(trim($email));

        if ($this->isMember($email)) {
            throw ValidationException::withMessages(['email' => 'Esta pessoa já faz parte da equipe.']);
        }

        $pending = Invitation::query()->whereRaw('lower(email) = ?', [$email])->whereNull('accepted_at')->whereNull('revoked_at')->first();
        if ($pending !== null && ! $pending->isExpired()) {
            throw ValidationException::withMessages(['email' => 'Já existe um convite pendente para este e-mail. Use "Reenviar" na lista de convites.']);
        }

        return DB::transaction(function () use ($pending, $email, $role, $projectIds): array {
            // Convite vencido para o mesmo e-mail sai do caminho (índice: um pendente por e-mail).
            $pending?->forceFill(['revoked_at' => now()])->save();

            $token = self::newToken();
            $invitation = Invitation::query()->create([
                'email' => $email,
                'role' => $role,
                'project_ids' => $role === TenantRole::Client ? array_values(array_unique($projectIds)) : [],
                'token_hash' => self::hash($token),
                'invited_by' => $this->context->userId(),
                'expires_at' => now()->addDays(self::TTL_DAYS),
            ]);

            $this->send($invitation, $token);

            return [$invitation, $token];
        });
    }

    /** Novo link e nova validade; o link anterior deixa de valer. */
    public function resend(Invitation $invitation): string
    {
        $token = self::newToken();
        $invitation->forceFill([
            'token_hash' => self::hash($token),
            'expires_at' => now()->addDays(self::TTL_DAYS),
            'invited_by' => $this->context->userId() ?? $invitation->invited_by,
        ])->save();

        $this->send($invitation, $token);

        return $token;
    }

    public function revoke(Invitation $invitation): void
    {
        $invitation->forceFill(['revoked_at' => now()])->save();
    }

    public function preview(string $token): ?InvitationPreview
    {
        if (! self::looksLikeToken($token)) {
            return null;
        }

        /** @var object{tenant_name: string, email: string, role: string, inviter_name: string|null, expires_at: string, status: 'pending'|'accepted'|'revoked'|'expired'}|null $row */
        $row = DB::selectOne('select * from app.invitation_preview(?)', [self::hash($token)]);

        if ($row === null) {
            return null;
        }

        return new InvitationPreview(
            $row->tenant_name,
            $row->email,
            TenantRole::from($row->role),
            $row->inviter_name,
            CarbonImmutable::parse($row->expires_at),
            $row->status,
        );
    }

    /** Aceita como o usuário informado. Devolve o id da agência, ou null se o convite não vale mais. */
    public function accept(string $token, User $user): ?string
    {
        if (! self::looksLikeToken($token)) {
            return null;
        }

        return $this->context->run(null, $user->id, function () use ($token): ?string {
            $tenantId = DB::scalar('select app.accept_invitation(?)', [self::hash($token)]);

            return is_string($tenantId) ? $tenantId : null;
        });
    }

    public static function url(string $token): string
    {
        $base = config('delta.frontend_url');

        return rtrim(is_string($base) ? $base : '', '/').'/convite/'.$token;
    }

    public static function looksLikeToken(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9]{48}$/', $token) === 1;
    }

    private function isMember(string $email): bool
    {
        $tenantId = $this->context->tenantId();

        // tenant_user também mostra os vínculos do próprio usuário em outras agências: filtra a do contexto.
        return TenantMembership::query()
            ->where('tenant_id', $tenantId)
            ->whereHas('user', fn ($q) => $q->whereRaw('lower(email) = ?', [$email]))
            ->exists();
    }

    private function send(Invitation $invitation, string $token): void
    {
        $inviter = $invitation->invited_by !== null ? User::query()->whereKey($invitation->invited_by)->value('name') : null;
        $tenant = Tenant::query()->whereKey($invitation->tenant_id)->value('name');
        $projects = $invitation->project_ids === []
            ? []
            : Project::query()->whereIn('id', $invitation->project_ids)->orderBy('name')->pluck('name')->all();

        Mail::to($invitation->email)->queue(new InvitationMail(
            tenantName: is_string($tenant) ? $tenant : 'sua agência',
            inviterName: is_string($inviter) ? $inviter : null,
            roleLabel: $invitation->role->label(),
            projectNames: array_values(array_filter($projects, 'is_string')),
            url: self::url($token),
            expiresAt: $invitation->expires_at->copy()->timezone(self::timezone())->format('d/m/Y \à\s H:i'),
        ));
    }

    private static function timezone(): string
    {
        $tz = config('delta.timezone');

        return is_string($tz) && $tz !== '' ? $tz : 'America/Sao_Paulo';
    }

    private static function newToken(): string
    {
        return Str::random(48);
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
