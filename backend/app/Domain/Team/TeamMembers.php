<?php

declare(strict_types=1);

namespace App\Domain\Team;

use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\TenantMembership;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Regras da equipe:
 *  - só dono mexe em dono (mudar papel, remover) ou promove alguém a dono;
 *  - a agência nunca fica sem dono;
 *  - ninguém remove a si mesmo por aqui;
 *  - cliente precisa de ao menos um projeto (é tudo o que ele vê).
 */
final readonly class TeamMembers
{
    public function __construct(private TenantContext $context) {}

    public function find(string $userId): ?TenantMembership
    {
        return TenantMembership::query()->where('tenant_id', $this->context->tenantId())->where('user_id', $userId)->first();
    }

    /** @param list<string> $projectIds */
    public function changeRole(TenantMembership $actor, TenantMembership $target, TenantRole $role, array $projectIds): void
    {
        $this->guardOwners($actor, $target, $role);

        if ($target->role === TenantRole::Owner && $role !== TenantRole::Owner && $this->ownerCount() === 1) {
            throw ValidationException::withMessages(['role' => 'A agência precisa de pelo menos um dono.']);
        }

        DB::transaction(function () use ($target, $role, $projectIds): void {
            $target->role = $role;
            $target->save();

            if ($role === TenantRole::Client) {
                $this->syncProjects($target->user_id, $projectIds);
            }
        });
    }

    public function remove(TenantMembership $actor, TenantMembership $target): void
    {
        if ($actor->user_id === $target->user_id) {
            throw ValidationException::withMessages(['member' => 'Você não pode remover a si mesmo.']);
        }

        $this->guardOwners($actor, $target, $target->role);

        if ($target->role === TenantRole::Owner && $this->ownerCount() === 1) {
            throw ValidationException::withMessages(['member' => 'A agência precisa de pelo menos um dono.']);
        }

        DB::transaction(function () use ($target): void {
            ProjectMember::query()->where('user_id', $target->user_id)->delete();
            $target->delete();
        });
    }

    /**
     * @param  list<string>  $projectIds
     * @return list<string> só os que existem na agência (o RLS já esconde os das outras)
     */
    public function existingProjects(array $projectIds): array
    {
        $ids = array_values(array_unique($projectIds));
        if ($ids === []) {
            return [];
        }

        $found = Project::query()->whereIn('id', $ids)->pluck('id')->all();

        if (count($found) !== count($ids)) {
            throw ValidationException::withMessages(['project_ids' => 'Algum dos projetos escolhidos não existe mais. Atualize a página e tente de novo.']);
        }

        return array_values(array_filter($found, 'is_string'));
    }

    private function guardOwners(TenantMembership $actor, TenantMembership $target, TenantRole $role): void
    {
        $touchesOwner = $target->role === TenantRole::Owner || $role === TenantRole::Owner;

        abort_if($touchesOwner && $actor->role !== TenantRole::Owner, 403, 'Só um dono pode alterar ou promover donos.');
    }

    private function ownerCount(): int
    {
        return TenantMembership::query()
            ->where('tenant_id', $this->context->tenantId())
            ->where('role', TenantRole::Owner->value)
            ->count();
    }

    /** @param list<string> $projectIds */
    private function syncProjects(string $userId, array $projectIds): void
    {
        $ids = $this->existingProjects($projectIds);

        ProjectMember::query()->where('user_id', $userId)->whereNotIn('project_id', $ids)->delete();
        $current = ProjectMember::query()->where('user_id', $userId)->get()->map(fn (ProjectMember $m): string => $m->project_id)->all();

        foreach (array_diff($ids, $current) as $projectId) {
            ProjectMember::query()->create(['project_id' => $projectId, 'user_id' => $userId]);
        }
    }
}
