<?php

declare(strict_types=1);

namespace App\Http\Requests\Concerns;

use App\Models\TenantMembership;

/** Autoriza só a equipe da agência (dono, admin, analista); o papel cliente é somente leitura. */
trait RequiresStaff
{
    public function authorize(): bool
    {
        $membership = $this->attributes->get('membership');

        return $membership instanceof TenantMembership && $membership->role->canManageProjects();
    }
}
