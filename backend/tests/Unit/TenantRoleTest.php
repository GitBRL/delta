<?php

declare(strict_types=1);

use App\Support\Tenancy\TenantRole;

it('trata todo papel diferente de cliente como equipe da agência', function (TenantRole $role, bool $staff) {
    expect($role->isStaff())->toBe($staff)
        ->and($role->canManageProjects())->toBe($staff);
})->with([
    [TenantRole::Owner, true],
    [TenantRole::Admin, true],
    [TenantRole::Analyst, true],
    [TenantRole::Client, false],
]);

it('usa os mesmos valores do CHECK de tenant_user.role', function () {
    expect(array_map(fn (TenantRole $r) => $r->value, TenantRole::cases()))
        ->toBe(['owner', 'admin', 'analyst', 'client']);
});
