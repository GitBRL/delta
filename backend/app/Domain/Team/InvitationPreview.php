<?php

declare(strict_types=1);

namespace App\Domain\Team;

use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;

/** O que a página pública do convite mostra (vem de app.invitation_preview). */
final readonly class InvitationPreview
{
    /** @param 'pending'|'accepted'|'revoked'|'expired' $status */
    public function __construct(
        public string $tenantName,
        public string $email,
        public TenantRole $role,
        public ?string $inviterName,
        public CarbonImmutable $expiresAt,
        public string $status,
    ) {}

    public function unavailableMessage(): string
    {
        return match ($this->status) {
            'accepted' => 'Este convite já foi aceito. Entre no Delta para acessar a agência.',
            'revoked' => 'Este convite foi cancelado pela agência. Peça um novo convite a quem convidou você.',
            'expired' => 'Este convite expirou. Peça um novo convite a quem convidou você.',
            default => 'Este convite não está mais disponível.',
        };
    }
}
