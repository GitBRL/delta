<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use App\Domain\Integrations\DiscoveredAccount;
use App\Domain\Integrations\OAuth\OAuthTokens;
use App\Domain\Publishing\PublishingService;
use App\Mail\PostApprovalMail;
use App\Models\Contact;
use App\Models\Post;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

/*
| Publishing (ADR 0028): mídia, posts, aprovação do cliente por link e publicação agendada.
*/

beforeEach(function () {
    Storage::fake('local');
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'ecommerce']));
    $ig = connectSandbox($this->tenant, $this->owner, 'instagram');
    $fb = connectSandbox($this->tenant, $this->owner, 'facebook');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->igAccount = $ig->accounts->firstOrFail()->id;
    $this->fbAccount = $fb->accounts->firstOrFail()->id;
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$this->igAccount, $this->fbAccount]], $this->headers)->assertOk();
});

function upload(UploadedFile $file): array
{
    $t = test();

    return $t->actingAs($t->owner)->post('/api/media', ['file' => $file, 'project_id' => $t->project->id], [...$t->headers, 'Accept' => 'application/json'])->assertCreated()->json('data');
}

function mp4(): UploadedFile
{
    // Cabeçalho "ftyp" de um MP4 real: o tipo é conferido pelo conteúdo, não pela extensão.
    return UploadedFile::fake()->createWithContent('reels.mp4', "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom".str_repeat("\x00", 2048));
}

function newPost(array $overrides = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/posts', [
        'project_id' => $t->project->id, 'title' => 'Pão de fermentação natural', 'caption' => 'Fornada nova! #padaria',
        'media' => [upload(UploadedFile::fake()->image('pao.png', 3000, 2000))['id']],
        'targets' => [['network' => 'instagram', 'format' => 'feed', 'account_id' => $t->igAccount]],
        ...$overrides,
    ], $t->headers);
}

function postRow(string $id): Post
{
    $t = test();
    $post = security()->run($t->tenant->id, null, fn () => Post::query()->with('targets')->findOrFail($id));
    security()->clear();

    return $post;
}

function approvalToken(string $link): string
{
    return basename($link);
}

it('recodifica imagens em JPEG, aceita vídeo pelo conteúdo e recusa o resto', function () {
    $image = upload(UploadedFile::fake()->image('pao.png', 3000, 2000));
    expect($image['kind'])->toBe('image')->and($image['mime'])->toBe('image/jpeg')
        ->and($image['width'])->toBe(2160)->and($image['height'])->toBe(1440);

    $video = upload(mp4());
    expect($video['kind'])->toBe('video')->and($video['mime'])->toBe('video/mp4');

    $this->actingAs($this->owner)->post('/api/media', ['file' => UploadedFile::fake()->createWithContent('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')], [...$this->headers, 'Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonValidationErrors(['file' => 'MP4 ou MOV']);
    $this->actingAs($this->owner)->post('/api/media', ['file' => UploadedFile::fake()->createWithContent('falso.mp4', 'não sou vídeo')], [...$this->headers, 'Accept' => 'application/json'])
        ->assertUnprocessable();

    // Link assinado: abre sem login; adulterado, não.
    auth()->forgetGuards();
    $this->get($image['url'])->assertOk()->assertHeader('Content-Type', 'image/jpeg')->assertHeader('X-Content-Type-Options', 'nosniff');
    $this->get(str_replace('signature=', 'signature=0', $image['url']))->assertForbidden();
});

it('valida contas do projeto e mostra o que falta para cada rede', function () {
    $video = upload(mp4())['id'];
    $other = connectSandbox($this->tenant, $this->owner, 'instagram')->accounts->firstOrFail()->id; // não ligada ao projeto
    security()->clear();

    newPost(['targets' => [['network' => 'instagram', 'format' => 'feed', 'account_id' => $other]]])
        ->assertUnprocessable()->assertJsonValidationErrors('targets.0.account_id');
    newPost(['targets' => [['network' => 'facebook', 'format' => 'feed', 'account_id' => $this->igAccount]]])
        ->assertUnprocessable()->assertJsonValidationErrors('targets.0.account_id');
    newPost(['targets' => [['network' => 'instagram', 'format' => 'short', 'account_id' => $this->igAccount]]])
        ->assertUnprocessable()->assertJsonValidationErrors('targets.0.format');

    $post = newPost(['targets' => [
        ['network' => 'instagram', 'format' => 'reels', 'account_id' => $this->igAccount],
        ['network' => 'facebook', 'format' => 'feed', 'account_id' => $this->fbAccount],
    ]])->assertCreated()->json('data');
    expect($post['problems'])->toBe(['Instagram (Reels): use exatamente 1 vídeo.']);

    $fixed = $this->actingAs($this->owner)->patchJson("/api/posts/{$post['id']}", ['media' => [$video]], $this->headers)->assertOk()->json('data');
    expect($fixed['problems'])->toBe([]);
});

it('leva o post do rascunho à aprovação do cliente por link, com aviso por e-mail', function () {
    Mail::fake();
    asTenant($this->tenant, fn () => Contact::query()->create(['project_id' => $this->project->id, 'name' => 'Marina', 'email' => 'marina@padaria.com', 'email_opt_in' => true]));
    $post = newPost()->json('data');

    $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/schedule", ['scheduled_at' => now()->addDay()->toIso8601String()], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['scheduled_at' => 'aprovação do cliente']);

    $requested = $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/approval", [], $this->headers)->assertOk();
    expect($requested->json('data.status'))->toBe('in_review')->and($requested->json('meta.notified'))->toBe(['email' => 1, 'whatsapp' => 0]);
    Mail::assertQueued(PostApprovalMail::class, fn (PostApprovalMail $m) => $m->hasTo('marina@padaria.com') && $m->url === $requested->json('meta.link'));

    $token = approvalToken($requested->json('meta.link'));
    auth()->forgetGuards();
    security()->clear();
    $page = $this->getJson("/api/public/approvals/{$token}")->assertOk()->json('data');
    expect($page['project']['name'])->toBe('Padaria Aurora')->and($page['approval']['state'])->toBe('open')
        ->and($page['post']['targets'][0]['network_label'])->toBe('Instagram')
        ->and($page['post']['media'][0]['url'])->toContain('/api/public/media/')
        ->and(json_encode($page))->not->toContain($token); // sem o token nem o link interno

    $this->postJson("/api/public/approvals/{$token}", ['decision' => 'changes_requested'])->assertUnprocessable()->assertJsonValidationErrors('comment');
    $this->postJson("/api/public/approvals/{$token}", ['decision' => 'changes_requested', 'comment' => 'Trocar a foto', 'name' => 'Marina'])->assertOk()->assertJsonPath('data.status', 'changes_requested');
    $this->postJson("/api/public/approvals/{$token}", ['decision' => 'approved'])->assertUnprocessable()->assertJsonValidationErrors(['decision' => 'já foi respondido']);
    $this->getJson('/api/public/approvals/'.str_repeat('x', 48))->assertNotFound();

    $staffView = $this->actingAs($this->owner)->getJson("/api/posts/{$post['id']}", $this->headers)->json('data');
    expect($staffView['approval']['comment'])->toBe('Trocar a foto')->and($staffView['approval']['decided_by_name'])->toBe('Marina');
});

it('agenda sozinho quando o cliente aprova um post que já tinha data, e publica na hora em demonstração', function () {
    $post = newPost(['targets' => [
        ['network' => 'instagram', 'format' => 'feed', 'account_id' => $this->igAccount],
        ['network' => 'facebook', 'format' => 'feed', 'account_id' => $this->fbAccount],
    ]])->json('data');
    $link = $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/approval", ['notify' => false], $this->headers)->json('meta.link');
    $at = now()->addHours(3)->startOfMinute();
    $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/schedule", ['scheduled_at' => $at->toIso8601String()], $this->headers)->assertOk()->assertJsonPath('data.status', 'in_review');

    auth()->forgetGuards();
    security()->clear();
    $this->postJson('/api/public/approvals/'.approvalToken($link), ['decision' => 'approved'])->assertOk()->assertJsonPath('data.status', 'scheduled');

    Artisan::call('posts:publish-due');
    expect(postRow($post['id'])->status)->toBe('scheduled'); // ainda não chegou a hora

    asTenant($this->tenant, fn () => DB::table('posts')->where('id', $post['id'])->update(['scheduled_at' => now()->subMinute()]));
    Artisan::call('posts:publish-due');
    $published = postRow($post['id']);
    expect($published->status)->toBe('published')->and($published->published_at)->not->toBeNull()
        ->and($published->targets->pluck('status')->all())->toBe(['published', 'published'])
        ->and($published->targets->first()->external_id)->toStartWith('sbx_instagram_');

    // Publicado não se edita nem se apaga.
    $this->actingAs($this->owner)->patchJson("/api/posts/{$post['id']}", ['caption' => 'x'], $this->headers)->assertUnprocessable();
    $this->actingAs($this->owner)->deleteJson("/api/posts/{$post['id']}", [], $this->headers)->assertUnprocessable();
});

it('editar o conteúdo depois da aprovação invalida a aprovação', function () {
    $post = newPost()->json('data');
    $link = $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/approval", ['notify' => false], $this->headers)->json('meta.link');
    auth()->forgetGuards();
    security()->clear();
    $this->postJson('/api/public/approvals/'.approvalToken($link), ['decision' => 'approved'])->assertOk();

    $edited = $this->actingAs($this->owner)->patchJson("/api/posts/{$post['id']}", ['caption' => 'Legenda nova'], $this->headers)->assertOk();
    expect($edited->json('data.status'))->toBe('draft')->and($edited->json('meta.approval_reset'))->toBeTrue();
});

it('publica agora sem aprovação quando o post não exige', function () {
    $post = newPost(['requires_approval' => false])->json('data');

    $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/publish", [], $this->headers)->assertAccepted()->assertJsonPath('data.status', 'published');
});

function liveInstagram(): string
{
    $t = test();
    $account = security()->run($t->tenant->id, $t->owner->id, function () use ($t): string {
        $connection = app(ConnectionManager::class)->connectLive('instagram', new OAuthTokens('EAAG-user', null, CarbonImmutable::now()->addDays(50)), [new DiscoveredAccount('17841400000000001', '@padaria', 'profile')], $t->owner->id);
        $id = $connection->accounts()->value('id');
        $t->project->accounts()->syncWithoutDetaching([$id]);

        return $id;
    });
    security()->clear();

    return $account;
}

it('publica de verdade no Instagram: contêiner, espera o vídeo e publica uma única vez', function () {
    Http::fake([
        'graph.facebook.com/v24.0/17841400000000001/insights*' => Http::response(['data' => []]),
        'graph.facebook.com/v24.0/17841400000000001/media_publish' => Http::response(['id' => '1790000000000009']),
        'graph.facebook.com/v24.0/17841400000000001/media' => Http::response(['id' => 'container-7']),
        'graph.facebook.com/v24.0/container-7*' => Http::sequence()->push(['status_code' => 'IN_PROGRESS'])->push(['status_code' => 'FINISHED']),
        'graph.facebook.com/v24.0/1790000000000009*' => Http::response(['permalink' => 'https://www.instagram.com/reel/abc/']),
        'graph.facebook.com/*' => Http::response(['data' => []]),
    ]);
    $account = liveInstagram();
    $post = newPost(['requires_approval' => false, 'media' => [upload(mp4())['id']], 'targets' => [['network' => 'instagram', 'format' => 'reels', 'account_id' => $account]]])->json('data');

    $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/schedule", ['scheduled_at' => now()->addHour()->toIso8601String()], $this->headers)->assertOk();
    asTenant($this->tenant, fn () => DB::table('posts')->where('id', $post['id'])->update(['scheduled_at' => now()->subMinute()]));

    $publishing = app(PublishingService::class);
    $first = security()->run($this->tenant->id, null, fn () => $publishing->publish(Post::query()->findOrFail($post['id'])));
    expect($first)->toBeTrue() // vídeo em processamento: tenta de novo
        ->and(postRow($post['id'])->status)->toBe('publishing');

    $second = security()->run($this->tenant->id, null, fn () => $publishing->publish(Post::query()->findOrFail($post['id'])));
    security()->clear();
    $done = postRow($post['id']);

    expect($second)->toBeFalse()->and($done->status)->toBe('published')
        ->and($done->targets->first()->permalink)->toBe('https://www.instagram.com/reel/abc/');
    // Um único contêiner e uma única publicação, mesmo com a nova tentativa.
    expect(Http::recorded(fn (Request $r) => $r->method() === 'POST' && str_ends_with($r->url(), '/17841400000000001/media'))->count())->toBe(1)
        ->and(Http::recorded(fn (Request $r) => str_ends_with($r->url(), '/media_publish'))->count())->toBe(1);
    Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/17841400000000001/media') && $r['media_type'] === 'REELS'
        && str_contains((string) $r['video_url'], '/api/public/media/') && str_contains((string) $r['video_url'], 'signature=') && $r->hasHeader('Authorization', 'Bearer EAAG-user'));
});

it('falha com orientação quando a conta não deu permissão de publicar, e avisa por webhook', function () {
    Http::fake([
        'graph.facebook.com/v24.0/17841400000000001/media' => Http::response(['error' => ['code' => 10, 'message' => 'Application does not have permission for this action']], 403),
        'graph.facebook.com/*' => Http::response(['data' => []]),
    ]);
    $account = liveInstagram();
    $post = newPost(['requires_approval' => false, 'targets' => [['network' => 'instagram', 'format' => 'feed', 'account_id' => $account]]])->json('data');

    $result = $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/publish", [], $this->headers)->assertAccepted()->json('data');

    expect($result['status'])->toBe('failed')->and($result['targets'][0]['status'])->toBe('failed')
        ->and($result['targets'][0]['error'])->toContain('permissão necessária');
});

it('não republica às cegas um destino que ficou no meio da publicação', function () {
    $post = newPost(['requires_approval' => false])->json('data');
    asTenant($this->tenant, function () use ($post): void {
        DB::table('posts')->where('id', $post['id'])->update(['status' => 'publishing', 'updated_at' => now()->subHour()]);
        DB::table('post_targets')->where('post_id', $post['id'])->update(['status' => 'publishing']);
    });

    expect(collect(DB::select('select * from app.due_posts(now())'))->pluck('post_id')->all())->toBe([$post['id']]);
    Artisan::call('posts:publish-due');

    $row = postRow($post['id']);
    expect($row->status)->toBe('failed')->and($row->targets->first()->error)->toContain('pode ter saído na rede');
});

it('o cliente vê os posts do projeto dele, sem o link de aprovação, e não edita', function () {
    $post = newPost()->json('data');
    $this->actingAs($this->owner)->postJson("/api/posts/{$post['id']}/approval", ['notify' => false], $this->headers)->assertOk();
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    asTenant($this->tenant, fn () => DB::table('project_members')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $this->tenant->id, 'project_id' => $this->project->id, 'user_id' => $client->id, 'created_at' => now(), 'updated_at' => now()]));

    $seen = $this->actingAs($client)->getJson('/api/posts', $this->headers)->assertOk()->json('data');
    expect($seen)->toHaveCount(1)->and($seen[0]['approval'])->toBeNull();
    $this->actingAs($client)->postJson('/api/posts', ['project_id' => $this->project->id], $this->headers)->assertForbidden();

    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    $this->actingAs($otherOwner)->getJson("/api/posts/{$post['id']}", ['X-Tenant-Id' => $other->id])->assertNotFound();
});
