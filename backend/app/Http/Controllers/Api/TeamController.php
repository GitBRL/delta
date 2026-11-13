<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Team\TeamMembers;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateMemberRequest;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;

/** Equipe da agência: membros, papéis e convites pendentes. Só dono e administrador (middleware tenant.admin). */
final class TeamController extends Controller
{
    public function __construct(
        private readonly TeamMembers $members,
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $memberships = TenantMembership::query()
            ->where('tenant_id', $this->context->tenantId())
            ->with('user')
            ->get();

        $clientIds = array_values($memberships->filter(fn (TenantMembership $m) => $m->role === TenantRole::Client)
            ->map(fn (TenantMembership $m): string => $m->user_id)->all());
        $projectsByUser = $this->clientProjects($clientIds);

        $members = $memberships
            ->sortBy(fn (TenantMembership $m): string => $m->role->rank().'|'.mb_strtolower($m->user->name ?? ''))
            ->map(fn (TenantMembership $m): array => $this->presentMember($m, $projectsByUser[$m->user_id] ?? []))
            ->values()
            ->all();

        $invitations = Invitation::query()->whereNull('accepted_at')->whereNull('revoked_at')->orderByDesc('created_at')->get();

        return response()->json(['data' => [
            'members' => $members,
            'invitations' => self::presentInvitations($invitations),
            'can_manage_owners' => self::actor($request)->role === TenantRole::Owner,
        ]]);
    }

    /** Lista enxuta da equipe (id e nome) para escolher responsáveis — aberta a toda a equipe. */
    public function staff(): JsonResponse
    {
        $members = TenantMembership::query()->where('tenant_id', $this->context->tenantId())
            ->where('role', '!=', TenantRole::Client->value)->with('user:id,name')->get()
            ->map(fn (TenantMembership $m): array => ['id' => $m->user_id, 'name' => $m->user->name ?? ''])
            ->sortBy('name')->values()->all();

        return response()->json(['data' => $members]);
    }

    public function update(UpdateMemberRequest $request, string $userId): JsonResponse
    {
        $target = $this->members->find($userId) ?? abort(404, 'Esta pessoa não faz parte da equipe.');
        $from = $target->role;
        $role = TenantRole::from($request->string('role')->toString());

        $this->members->changeRole(self::actor($request), $target, $role, $request->projectIds());
        $this->audit->record('member.role_changed', $target, ['user_id' => $userId, 'from' => $from->value, 'to' => $role->value]);

        $target->load('user');

        return response()->json(['data' => $this->presentMember($target, $this->clientProjects([$userId])[$userId] ?? [])]);
    }

    public function destroy(Request $request, string $userId): Response
    {
        $target = $this->members->find($userId) ?? abort(404, 'Esta pessoa não faz parte da equipe.');

        $this->members->remove(self::actor($request), $target);
        $this->audit->record('member.removed', null, ['user_id' => $userId, 'role' => $target->role->value]);

        return response()->noContent();
    }

    /**
     * @param  Collection<int, Invitation>  $invitations
     * @return list<array<string, mixed>>
     */
    public static function presentInvitations(Collection $invitations): array
    {
        $projectIds = $invitations->flatMap(fn (Invitation $i): array => $i->project_ids)->unique()->values()->all();
        $projects = $projectIds === [] ? collect() : Project::query()->whereIn('id', $projectIds)->pluck('name', 'id');
        $inviterIds = $invitations->pluck('invited_by')->filter()->unique()->values()->all();
        $inviters = $inviterIds === [] ? collect() : User::query()->whereIn('id', $inviterIds)->pluck('name', 'id');

        return array_values($invitations->map(fn (Invitation $i): array => [
            'id' => $i->id,
            'email' => $i->email,
            'role' => $i->role->value,
            'projects' => array_values(array_filter(array_map(
                fn (string $id): ?array => $projects->has($id) ? ['id' => $id, 'name' => $projects->get($id)] : null,
                $i->project_ids,
            ))),
            'invited_by' => $i->invited_by !== null ? $inviters->get($i->invited_by) : null,
            'created_at' => $i->created_at?->toIso8601String(),
            'expires_at' => $i->expires_at->toIso8601String(),
            'expired' => $i->isExpired(),
        ])->all());
    }

    /**
     * @param  list<array{id: string, name: string}>  $projects
     * @return array<string, mixed>
     */
    private function presentMember(TenantMembership $membership, array $projects): array
    {
        $joined = $membership->getAttribute('created_at');

        return [
            'user_id' => $membership->user_id,
            'name' => $membership->user->name ?? '',
            'email' => $membership->user->email ?? '',
            'role' => $membership->role->value,
            'joined_at' => $joined instanceof CarbonInterface ? $joined->toIso8601String() : null,
            'is_you' => $membership->user_id === $this->context->userId(),
            'projects' => $membership->role === TenantRole::Client ? $projects : [],
        ];
    }

    /**
     * @param  list<string>  $userIds
     * @return array<string, list<array{id: string, name: string}>>
     */
    private function clientProjects(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        $byUser = [];
        $rows = ProjectMember::query()->whereIn('user_id', $userIds)->with('project:id,name')->get();
        foreach ($rows as $row) {
            if ($row->project !== null) {
                $byUser[$row->user_id][] = ['id' => $row->project->id, 'name' => $row->project->name];
            }
        }

        foreach ($byUser as &$list) {
            usort($list, fn (array $a, array $b): int => strcmp(mb_strtolower($a['name']), mb_strtolower($b['name'])));
        }

        return $byUser;
    }

    private static function actor(Request $request): TenantMembership
    {
        $membership = $request->attributes->get('membership');

        return $membership instanceof TenantMembership ? $membership : abort(403);
    }
}
