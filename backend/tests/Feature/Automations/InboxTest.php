<?php

declare(strict_types=1);

use App\Models\Project;
use App\Support\Tenancy\TenantRole;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

const INBOX_PHONE_ID = '109876543210987';
const INBOX_SECRET = 'abcdef0123456789abcdef0123456789';

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
    $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/contacts", ['name' => 'Marina Souza', 'phone' => '11999998888', 'whatsapp_opt_in' => true], $this->headers)->assertCreated();
});

function inboundWebhook(string $text, string $id): void
{
    $body = json_encode(['entry' => [['changes' => [['value' => [
        'metadata' => ['phone_number_id' => INBOX_PHONE_ID],
        'messages' => [['from' => '5511999998888', 'id' => $id, 'type' => 'text', 'text' => ['body' => $text]]],
    ]]]]]], JSON_THROW_ON_ERROR);
    auth()->forgetGuards();
    security()->clear();
    test()->call('POST', '/api/webhooks/whatsapp', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $body, INBOX_SECRET)], $body)->assertOk();
}

it('recebe a resposta do cliente pelo webhook e responde dentro da janela de 24 horas', function () {
    Http::fake([
        'graph.facebook.com/v24.0/'.INBOX_PHONE_ID.'/messages' => Http::response(['messages' => [['id' => 'wamid.REPLY1']]]),
        'graph.facebook.com/v24.0/'.INBOX_PHONE_ID.'*' => Http::response(['display_phone_number' => '+55 11 4000-0000']),
    ]);
    $this->actingAs($this->owner)->putJson('/api/whatsapp', ['mode' => 'cloud', 'phone_number_id' => INBOX_PHONE_ID, 'access_token' => 'EAAG'.str_repeat('z', 40), 'app_secret' => INBOX_SECRET, 'template_name' => 'relatorio_periodico'], $this->headers)->assertOk();

    inboundWebhook('Oi! Podemos falar sobre o relatório?', 'wamid.IN1');
    inboundWebhook('Oi! Podemos falar sobre o relatório?', 'wamid.IN1'); // a Meta reenviou: não duplica

    $response = $this->actingAs($this->owner)->getJson('/api/whatsapp/conversations', $this->headers)->assertOk()->assertJsonPath('meta.mode', 'cloud');
    $list = $response->json('data');
    expect($list)->toHaveCount(1)
        ->and($list[0])->toMatchArray(['phone' => '+5511999998888', 'unread' => 1, 'window_open' => true])
        ->and($list[0]['contact']['name'])->toBe('Marina Souza');

    $this->actingAs($this->owner)->getJson('/api/whatsapp/conversations/5511999998888', $this->headers)->assertOk()->assertJsonCount(1, 'data.messages');
    expect($this->actingAs($this->owner)->getJson('/api/whatsapp/conversations', $this->headers)->json('data.0.unread'))->toBe(0);

    $this->actingAs($this->owner)->postJson('/api/whatsapp/conversations/5511999998888/reply', ['text' => 'Claro, Marina! Te ligo às 15h.'], $this->headers)
        ->assertCreated()->assertJsonPath('data.direction', 'out');
    Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/messages') && $r['type'] === 'text' && $r['text']['body'] === 'Claro, Marina! Te ligo às 15h.');

    $this->travel(25)->hours();
    $this->actingAs($this->owner)->postJson('/api/whatsapp/conversations/5511999998888/reply', ['text' => 'Oi de novo'], $this->headers)
        ->assertUnprocessable()->assertJsonValidationErrors(['text' => 'janela de 24 horas']);
});

it('simula mensagens no modo demonstração e só a equipe acessa', function () {
    $this->actingAs($this->owner)->postJson('/api/whatsapp/simulate-inbound', ['phone' => '11 99999-8888', 'text' => 'Recebi o relatório, obrigada!'], $this->headers)->assertCreated();
    $this->actingAs($this->owner)->postJson('/api/whatsapp/conversations/5511999998888/reply', ['text' => 'Que bom!'], $this->headers)->assertCreated();

    $thread = $this->actingAs($this->owner)->getJson('/api/whatsapp/conversations/5511999998888', $this->headers)->json('data');
    expect(array_column($thread['messages'], 'direction'))->toBe(['in', 'out'])->and($thread['window_open'])->toBeTrue();

    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->clear();
    $this->actingAs($client)->getJson('/api/whatsapp/conversations', $this->headers)->assertForbidden();
});
