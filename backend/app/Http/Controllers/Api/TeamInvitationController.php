<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\Team\Invitations;
use App\Domain\Team\TeamMembers;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreInvitationRequest;
use App\Models\Invitation;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/** Convites para a equipe (dono e administrador). O link só aparece na criação e no reenvio. */
final class TeamInvitationController extends Controller
{
    public function __construct(
        private readonly Invitations $invitations,
        private readonly TeamMembers $members,
        private readonly Audit $audit,
    ) {}

    public function store(StoreInvitationRequest $request): JsonResponse
    {
        $role = TenantRole::from($request->string('role')->toString());
        if ($role !== TenantRole::Client) {
            app(Entitlements::class)->ensure('seats'); // convites pendentes contam como lugar ocupado
        }
        $projectIds = $role === TenantRole::Client ? $this->members->existingProjects($request->projectIds()) : [];

        [$invitation, $token] = $this->invitations->invite($request->string('email')->toString(), $role, $projectIds);
        $this->audit->record('invitation.created', $invitation, ['role' => $role->value, 'projects' => count($projectIds)]);

        return response()->json([
            'data' => TeamController::presentInvitations(collect([$invitation]))[0],
            'invite_url' => Invitations::url($token),
        ], 201);
    }

    public function resend(Invitation $invitation): JsonResponse
    {
        abort_if($invitation->accepted_at !== null || $invitation->revoked_at !== null, 410, 'Este convite já foi aceito ou cancelado.');

        $token = $this->invitations->resend($invitation);
        $this->audit->record('invitation.resent', $invitation);

        return response()->json([
            'data' => TeamController::presentInvitations(collect([$invitation->refresh()]))[0],
            'invite_url' => Invitations::url($token),
        ]);
    }

    public function destroy(Invitation $invitation): Response
    {
        abort_if($invitation->accepted_at !== null, 410, 'Este convite já foi aceito.');

        if ($invitation->revoked_at === null) {
            $this->invitations->revoke($invitation);
            $this->audit->record('invitation.revoked', $invitation);
        }

        return response()->noContent();
    }
}
