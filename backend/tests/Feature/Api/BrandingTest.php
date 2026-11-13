<?php

declare(strict_types=1);

use App\Domain\Branding\Brand;
use App\Domain\Branding\DnsResolver;
use App\Domain\Reports\Pdf\SnapshotPdf;
use App\Mail\ReportMail;
use App\Models\Project;
use App\Models\ReportSnapshot;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    Storage::fake('local');
});

function pngOf(int $w, int $h): string
{
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, (int) imagecolorallocate($img, 10, 132, 255));
    ob_start();
    imagepng($img);

    return (string) ob_get_clean();
}

it('usa o nome da agência e a cor padrão até a agência configurar', function () {
    $this->actingAs($this->owner)->getJson('/api/branding', $this->headers)->assertOk()
        ->assertJsonPath('data.name', 'Agência Aurora')
        ->assertJsonPath('data.color', Brand::DEFAULT_COLOR)
        ->assertJsonPath('data.logo_url', null)
        ->assertJsonPath('data.hide_delta_badge', false);
});

it('dono configura a marca; analista não; cliente só lê', function () {
    $this->actingAs($this->owner)->putJson('/api/branding', [
        'display_name' => 'Aurora Digital', 'primary_color' => '#FF5A1F', 'hide_delta_badge' => true, 'email_reply_to' => 'contato@aurora.test', 'custom_domain' => 'Relatorios.Aurora.com.br',
    ], $this->headers)->assertOk()
        ->assertJsonPath('data.name', 'Aurora Digital')
        ->assertJsonPath('data.color', '#ff5a1f')
        ->assertJsonPath('data.custom_domain', 'relatorios.aurora.com.br')
        ->assertJsonPath('data.domain_status', 'pending');

    $this->actingAs($this->owner)->putJson('/api/branding', ['primary_color' => 'laranja'], $this->headers)->assertUnprocessable()->assertJsonValidationErrors('primary_color');

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();
    $this->actingAs($analyst)->putJson('/api/branding', ['display_name' => 'X'], $this->headers)->assertForbidden();
    $this->actingAs($client)->getJson('/api/branding', $this->headers)->assertOk()->assertJsonPath('data.name', 'Aurora Digital');
});

it('recodifica e reduz o logo, recusa SVG e serve por link assinado', function () {
    $this->actingAs($this->owner)->post('/api/branding/logo', ['logo' => UploadedFile::fake()->createWithContent('logo.png', pngOf(800, 400))], $this->headers + ['Accept' => 'application/json'])->assertOk();

    $path = "branding/{$this->tenant->id}/logo.png";
    [$w, $h] = getimagesizefromstring((string) Storage::disk('local')->get($path));
    expect([$w, $h])->toBe([400, 200]);

    $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    $this->actingAs($this->owner)->post('/api/branding/logo', ['logo' => UploadedFile::fake()->createWithContent('logo.svg', $svg)], $this->headers + ['Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonValidationErrors('logo');

    $url = (string) $this->actingAs($this->owner)->getJson('/api/branding', $this->headers)->json('data.logo_url');
    auth()->forgetGuards();
    security()->clear();
    expect($url)->toStartWith("/api/public/branding/{$this->tenant->id}/logo?expires=");
    $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
    $this->get("/api/public/branding/{$this->tenant->id}/logo")->assertForbidden();
});

it('verifica o domínio próprio pelo CNAME', function () {
    $this->actingAs($this->owner)->putJson('/api/branding', ['custom_domain' => 'relatorios.aurora.com.br'], $this->headers)->assertOk();
    app()->instance(DnsResolver::class, new class extends DnsResolver
    {
        public array $answer = [];

        public function cnames(string $host): array
        {
            return $this->answer;
        }
    });

    $this->actingAs($this->owner)->postJson('/api/branding/domain/verify', [], $this->headers)->assertOk()->assertJsonPath('verification.ok', false);
    app(DnsResolver::class)->answer = ['relatorios.delta.app'];
    $this->actingAs($this->owner)->postJson('/api/branding/domain/verify', [], $this->headers)->assertOk()
        ->assertJsonPath('verification.ok', true)->assertJsonPath('data.domain_status', 'verified');
});

it('aplica a marca no PDF, no link público e no remetente do e-mail', function () {
    Http::fake(['gotenberg:3000/*' => Http::response('%PDF-1.7', 200)]);
    $this->actingAs($this->owner)->putJson('/api/branding', ['display_name' => 'Aurora Digital', 'primary_color' => '#ff5a1f', 'hide_delta_badge' => true], $this->headers)->assertOk();
    $this->actingAs($this->owner)->post('/api/branding/logo', ['logo' => UploadedFile::fake()->createWithContent('logo.png', pngOf(300, 100))], $this->headers + ['Accept' => 'application/json'])->assertOk();

    $project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria']));
    security()->clear();
    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $project->id, 'title' => 'Mensal'], $this->headers)->json('data');
    $snapshot = $this->actingAs($this->owner)->postJson("/api/reports/{$report['id']}/snapshots", [], $this->headers)->json('data');

    $html = security()->run($this->tenant->id, $this->owner->id, fn () => app(SnapshotPdf::class)->html(ReportSnapshot::query()->findOrFail($snapshot['id'])));
    expect($html)->toContain('#ff5a1f')->toContain('src="logo.png"')->toContain('Aurora Digital')->not->toContain('class="delta"');
    Http::assertSent(fn ($r) => collect($r->data())->contains(fn ($part) => ($part['filename'] ?? null) === 'logo.png'));

    $token = substr((string) $this->actingAs($this->owner)->postJson("/api/snapshots/{$snapshot['id']}/links", [], $this->headers)->json('url'), -40);
    auth()->forgetGuards();
    security()->clear();
    $this->getJson("/api/public/reports/{$token}")->assertJsonPath('data.branding.name', 'Aurora Digital')->assertJsonPath('data.branding.hide_delta_badge', true);

    $mail = new ReportMail('Assunto', 'Corpo', 'http://x/r/abc', 'http://x/descadastrar', 'Aurora Digital', replyToAddress: 'contato@aurora.test');
    expect($mail->envelope()->from?->name)->toBe('Aurora Digital')->and($mail->envelope()->replyTo[0]->address)->toBe('contato@aurora.test');
});
