<?php

declare(strict_types=1);

use App\Mail\UsageAlertMail;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

beforeEach(function () {
    Mail::fake();
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria']));
    $this->analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    Artisan::call('billing:plan', ['tenant' => $this->tenant->id, 'plan' => 'pro', '--status' => 'active']);
    config(['billing.plans.pro.limits.ai_tokens' => 1000]);
});

function spendAi(int $tokens): void
{
    asTenant(test()->tenant, fn () => DB::table('ai_usage')->insert(['tenant_id' => test()->tenant->id, 'feature' => 'teste', 'input_tokens' => $tokens, 'output_tokens' => 0, 'created_at' => now()]));
}

it('avisa dono e administradores a 80% e a 100%, uma vez por limiar no mês', function () {
    spendAi(500);
    Artisan::call('billing:usage-alerts');
    Mail::assertNothingQueued();

    spendAi(350); // 85%
    Artisan::call('billing:usage-alerts');
    Artisan::call('billing:usage-alerts');
    Mail::assertQueuedCount(1);
    Mail::assertQueued(UsageAlertMail::class, fn (UsageAlertMail $m) => $m->hasTo($this->owner->email) && ! $m->hasTo($this->analyst->email)
        && $m->alerts[0]['threshold'] === 80 && $m->alerts[0]['used'] === 850);

    spendAi(200); // 105%
    Artisan::call('billing:usage-alerts');
    Mail::assertQueuedCount(2);
    Mail::assertQueued(UsageAlertMail::class, fn (UsageAlertMail $m) => $m->alerts[0]['threshold'] === 100 && $m->envelope()->subject === 'A franquia do plano acabou neste mês');
});

it('quem já passa de 100% recebe só o aviso de esgotada', function () {
    spendAi(1200);
    Artisan::call('billing:usage-alerts');

    Mail::assertQueuedCount(1);
    Mail::assertQueued(UsageAlertMail::class, fn (UsageAlertMail $m) => count($m->alerts) === 1 && $m->alerts[0]['threshold'] === 100);
    expect(asTenant($this->tenant, fn () => DB::table('usage_alerts')->orderBy('threshold')->pluck('threshold')->all()))->toBe([80, 100]);
});
