<?php

declare(strict_types=1);

use App\Domain\Automations\MessageComposer;
use App\Models\Contact;
use App\Models\Message;
use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

const WA_PHONE_ID = '109876543210987';
const WA_SECRET = '0123456789abcdef0123456789abcdef';

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();

    Mail::fake();
    Storage::fake('local');
    Http::preventStrayRequests();
    Http::fake([
        'gotenberg:3000/*' => Http::response('%PDF-1.7 teste', 200),
        'graph.facebook.com/v24.0/'.WA_PHONE_ID.'/messages' => Http::response(['messages' => [['id' => 'wamid.ABC123']]]),
        'graph.facebook.com/v24.0/'.WA_PHONE_ID.'*' => Http::response(['display_phone_number' => '+55 11 4000-0000', 'verified_name' => 'Agência Aurora']),
    ]);
});

function configureCloud(): void
{
    $t = test();
    $t->actingAs($t->owner)->putJson('/api/whatsapp', [
        'mode' => 'cloud', 'phone_number_id' => WA_PHONE_ID, 'access_token' => 'EAAG'.str_repeat('x', 40), 'app_secret' => WA_SECRET, 'template_name' => 'relatorio_periodico',
    ], $t->headers)->assertOk();
}

function signedWebhook(array $payload)
{
    $body = json_encode($payload, JSON_THROW_ON_ERROR);

    return test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, WA_SECRET),
    ], $body);
}

it('começa em demonstração e o administrador liga o número oficial, conferido na Meta', function () {
    $this->actingAs($this->owner)->getJson('/api/whatsapp', $this->headers)->assertJsonPath('data.mode', 'sandbox')->assertJsonPath('data.status', 'sandbox');

    $saved = $this->actingAs($this->owner)->putJson('/api/whatsapp', [
        'mode' => 'cloud', 'phone_number_id' => WA_PHONE_ID, 'access_token' => 'EAAG'.str_repeat('x', 40), 'app_secret' => WA_SECRET, 'template_name' => 'relatorio_periodico',
    ], $this->headers)->assertOk()
        ->assertJsonPath('verification.ok', true)
        ->assertJsonPath('data.status', 'verified')
        ->assertJsonPath('data.display_phone', '+55 11 4000-0000')
        ->assertJsonPath('data.has_access_token', true)
        ->assertJsonPath('data.webhook_url', 'http://localhost:8000/api/webhooks/whatsapp');

    expect($saved->getContent())->not->toContain('EAAG')->not->toContain(WA_SECRET)
        ->and($saved->json('data.verify_token'))->toMatch('/^[A-Za-z0-9]{32}$/');

    $analyst = addUserToTenant($this->tenant, TenantRole::Analyst);
    security()->clear();
    $this->actingAs($analyst)->getJson('/api/whatsapp', $this->headers)->assertForbidden();
});

it('envia pelo template aprovado na Cloud API e acompanha o status pelo webhook assinado', function () {
    configureCloud();
    $contact = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/contacts", ['name' => 'Marina Souza', 'phone' => '11999998888', 'whatsapp_opt_in' => true], $this->headers)->json('data');
    $report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Semanal'], $this->headers)->json('data');
    $automation = $this->actingAs($this->owner)->postJson('/api/automations', [
        'name' => 'WhatsApp semanal', 'report_id' => $report['id'], 'channels' => ['whatsapp'], 'frequency' => 'weekly', 'weekday' => 1,
        'send_time' => '09:00', 'period_preset' => 'last_7', 'message' => MessageComposer::DEFAULT_MESSAGE, 'recipient_ids' => [$contact['id']],
    ], $this->headers)->json('data');

    $run = $this->actingAs($this->owner)->postJson("/api/automations/{$automation['id']}/run", [], $this->headers)->json('data');
    expect($run['counts']['sent'])->toBe(1);

    Http::assertSent(function ($r): bool {
        if (! str_ends_with($r->url(), '/'.WA_PHONE_ID.'/messages')) {
            return false;
        }
        $params = $r['template']['components'][0]['parameters'];

        return $r['to'] === '5511999998888' && $r['template']['name'] === 'relatorio_periodico' && $r['template']['language']['code'] === 'pt_BR'
            && count($params) === 5 && $params[0]['text'] === 'Marina' && str_contains($params[4]['text'], '/r/')
            && $r->hasHeader('Authorization', 'Bearer EAAG'.str_repeat('x', 40));
    });

    $status = fn (string $s, int $ts) => ['entry' => [['changes' => [['value' => [
        'metadata' => ['phone_number_id' => WA_PHONE_ID],
        'statuses' => [['id' => 'wamid.ABC123', 'status' => $s, 'timestamp' => (string) $ts]],
    ]]]]]];

    auth()->forgetGuards();
    security()->clear();
    signedWebhook($status('read', 1_794_500_000))->assertOk();
    signedWebhook($status('delivered', 1_794_499_000))->assertOk(); // atrasado: não volta o status

    $this->call('POST', '/api/webhooks/whatsapp', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_HUB_SIGNATURE_256' => 'sha256=falsa'], json_encode($status('failed', 1)))->assertOk();

    $message = security()->run($this->tenant->id, $this->owner->id, fn () => Message::query()->sole());
    expect($message->provider)->toBe('meta_cloud')
        ->and($message->status)->toBe('read')
        ->and($message->delivered_at)->not->toBeNull()
        ->and($message->read_at)->not->toBeNull();
});

it('responder PARAR no WhatsApp retira o consentimento', function () {
    configureCloud();
    $id = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/contacts", ['name' => 'Marina', 'phone' => '11999998888', 'whatsapp_opt_in' => true], $this->headers)->json('data.id');
    auth()->forgetGuards();
    security()->clear();

    signedWebhook(['entry' => [['changes' => [['value' => [
        'metadata' => ['phone_number_id' => WA_PHONE_ID],
        'messages' => [['from' => '5511999998888', 'type' => 'text', 'text' => ['body' => ' parar ']]],
    ]]]]]])->assertOk();

    $contact = security()->run($this->tenant->id, $this->owner->id, fn () => Contact::query()->with('consents')->findOrFail($id));
    expect($contact->whatsapp_opt_in)->toBeFalse()
        ->and($contact->consents->where('source', 'whatsapp_reply')->count())->toBe(1);
});

it('verifica o webhook só com o token de alguma agência', function () {
    configureCloud();
    $token = $this->actingAs($this->owner)->getJson('/api/whatsapp', $this->headers)->json('data.verify_token');
    auth()->forgetGuards();

    $this->get('/api/webhooks/whatsapp?'.http_build_query(['hub_mode' => 'subscribe', 'hub_verify_token' => $token, 'hub_challenge' => '42']))->assertOk()->assertSeeText('42');
    $this->get('/api/webhooks/whatsapp?'.http_build_query(['hub_mode' => 'subscribe', 'hub_verify_token' => 'errado', 'hub_challenge' => '42']))->assertForbidden();
});
