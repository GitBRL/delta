<?php

declare(strict_types=1);

use App\Domain\Contacts\Contacts;
use App\Models\Contact;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Tenancy\TenantRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora']));
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];
});

function newContact(array $body = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson("/api/projects/{$t->project->id}/contacts", [
        'name' => 'Marina Souza', 'email' => 'Marina@Padaria.test', 'phone' => '(11) 99999-8888', 'email_opt_in' => true, 'whatsapp_opt_in' => true, ...$body,
    ], $t->headers);
}

it('cadastra contato com telefone normalizado e registra o consentimento', function () {
    $contact = newContact()->assertCreated()
        ->assertJsonPath('data.email', 'marina@padaria.test')
        ->assertJsonPath('data.phone', '+5511999998888')
        ->assertJsonPath('data.phone_display', '+55 (11) 99999-8888')
        ->json('data');

    $this->actingAs($this->owner)->putJson("/api/contacts/{$contact['id']}", [...$contact, 'whatsapp_opt_in' => false], $this->headers)->assertOk();

    $history = $this->actingAs($this->owner)->getJson("/api/contacts/{$contact['id']}/consents", $this->headers)->json('data');
    expect(array_map(fn ($c) => [$c['channel'], $c['granted'], $c['source']], $history))->toEqualCanonicalizing([
        ['email', true, 'manual'], ['whatsapp', true, 'manual'], ['whatsapp', false, 'manual'],
    ])->and($history[0]['recorded_by'])->toBe($this->owner->name);
});

it('valida o contato', function () {
    newContact(['email' => null, 'phone' => null])->assertUnprocessable()->assertJsonValidationErrors(['email' => 'ao menos um e-mail ou um WhatsApp']);
    newContact(['phone' => '123'])->assertUnprocessable()->assertJsonValidationErrors('phone');
    newContact(['email' => 'nao-e-email'])->assertUnprocessable()->assertJsonValidationErrors('email');
});

it('só a equipe vê contatos e o histórico de consentimento é imutável', function () {
    $id = newContact()->json('data.id');
    $client = addUserToTenant($this->tenant, TenantRole::Client);
    security()->run($this->tenant->id, $this->owner->id, fn () => ProjectMember::query()->create(['project_id' => $this->project->id, 'user_id' => $client->id]));
    security()->clear();

    // Mesmo sendo membro do projeto, o cliente não gerencia contatos.
    $this->actingAs($client)->getJson("/api/projects/{$this->project->id}/contacts", $this->headers)->assertForbidden();

    security()->run($this->tenant->id, $client->id, fn () => expect(DB::table('contacts')->count())->toBe(0));
    security()->run($this->tenant->id, $this->owner->id, function () use ($id): void {
        expect(fn () => DB::transaction(fn () => DB::table('contact_consents')->where('contact_id', $id)->update(['granted' => false])))
            ->toThrow(QueryException::class, 'permission denied');
    });
});

it('descadastra pelo link assinado, sem login', function () {
    $id = newContact()->json('data.id');
    $url = security()->run($this->tenant->id, $this->owner->id, fn () => Contacts::unsubscribeUrl(Contact::query()->findOrFail($id), 'email'));
    expect($url)->toStartWith('http://localhost:4300/descadastrar?');

    $api = '/api/public/unsubscribe?'.parse_url($url, PHP_URL_QUERY);
    auth()->forgetGuards();
    security()->clear();

    $this->getJson($api)->assertOk()->assertJsonPath('data.name', 'Marina')->assertJsonPath('data.agency', 'Agência Aurora')->assertJsonPath('data.subscribed', true);
    $this->getJson(str_replace('channel=email', 'channel=whatsapp', $api))->assertForbidden(); // assinatura não confere
    $this->postJson($api)->assertOk()->assertJsonPath('data.subscribed', false);

    $contact = security()->run($this->tenant->id, $this->owner->id, fn () => Contact::query()->with('consents')->findOrFail($id));
    expect($contact->email_opt_in)->toBeFalse()
        ->and($contact->whatsapp_opt_in)->toBeTrue()
        ->and($contact->consents->where('source', 'unsubscribe_link')->count())->toBe(1);
});
