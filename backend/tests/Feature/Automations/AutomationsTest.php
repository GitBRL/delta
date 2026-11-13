<?php

declare(strict_types=1);

use App\Domain\Automations\MessageComposer;
use App\Domain\Automations\Schedule;
use App\Domain\Integrations\ConnectionManager;
use App\Mail\ReportMail;
use App\Models\Automation;
use App\Models\AutomationRun;
use App\Models\IntegrationConnection;
use App\Models\Message;
use App\Models\Project;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    [$this->tenant, $this->owner] = tenantWithOwner('Agência Aurora');
    $this->project = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Padaria Aurora', 'niche' => 'restaurante_delivery']));
    $meta = connectSandbox($this->tenant, $this->owner, 'meta_ads');
    security()->clear();
    $this->headers = ['X-Tenant-Id' => $this->tenant->id];

    $this->actingAs($this->owner)->putJson("/api/projects/{$this->project->id}/accounts", ['account_ids' => [$meta->accounts->firstOrFail()->id]], $this->headers)->assertOk();
    $this->report = $this->actingAs($this->owner)->postJson('/api/reports', ['project_id' => $this->project->id, 'title' => 'Relatório semanal'], $this->headers)->json('data');
    $this->marina = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/contacts", ['name' => 'Marina Souza', 'email' => 'marina@padaria.test', 'phone' => '11999998888', 'email_opt_in' => true, 'whatsapp_opt_in' => true], $this->headers)->json('data');
    $this->joao = $this->actingAs($this->owner)->postJson("/api/projects/{$this->project->id}/contacts", ['name' => 'João', 'email' => 'joao@padaria.test', 'phone' => '11988887777', 'email_opt_in' => true, 'whatsapp_opt_in' => false], $this->headers)->json('data');

    Mail::fake();
    Storage::fake('local');
    Http::fake(['gotenberg:3000/*' => Http::response('%PDF-1.7 teste', 200)]);
});

function automation(array $body = [])
{
    $t = test();

    return $t->actingAs($t->owner)->postJson('/api/automations', [
        'name' => 'Semanal da padaria',
        'report_id' => $t->report['id'],
        'channels' => ['email', 'whatsapp'],
        'frequency' => 'weekly',
        'weekday' => 1,
        'send_time' => '09:00',
        'period_preset' => 'last_7',
        'message' => MessageComposer::DEFAULT_MESSAGE,
        'recipient_ids' => [$t->marina['id'], $t->joao['id']],
        ...$body,
    ], $t->headers);
}

it('agenda no fuso da agência', function () {
    $created = automation()->assertCreated()->assertJsonPath('data.schedule_label', 'Toda segunda às 09:00')->json('data');
    $next = CarbonImmutable::parse($created['next_run_at'])->setTimezone(ConnectionManager::timezone());

    expect($next->dayOfWeekIso)->toBe(1)->and($next->format('H:i'))->toBe('09:00')->and($next->isFuture())->toBeTrue();
});

it('calcula a próxima data para cada frequência', function () {
    $base = CarbonImmutable::parse('2026-11-12 15:00', 'America/Sao_Paulo'); // quinta-feira
    $make = fn (array $attrs) => new Automation(['send_time' => '09:00', ...$attrs]);
    $local = fn (CarbonImmutable $d) => $d->setTimezone('America/Sao_Paulo')->format('Y-m-d H:i');

    expect($local(Schedule::next($make(['frequency' => 'daily']), $base)))->toBe('2026-11-13 09:00')
        ->and($local(Schedule::next($make(['frequency' => 'weekly', 'weekday' => 1]), $base)))->toBe('2026-11-16 09:00')
        ->and($local(Schedule::next($make(['frequency' => 'weekly', 'weekday' => 4, 'send_time' => '18:00']), $base)))->toBe('2026-11-12 18:00')
        ->and($local(Schedule::next($make(['frequency' => 'monthly', 'month_day' => 5]), $base)))->toBe('2026-12-05 09:00')
        ->and($local(Schedule::next($make(['frequency' => 'biweekly', 'weekday' => 1, 'last_run_at' => CarbonImmutable::parse('2026-11-09 12:00')]), $base)))->toBe('2026-11-23 09:00');
});

it('valida a automação', function () {
    $other = asTenant($this->tenant, fn () => Project::query()->create(['name' => 'Outro']));
    $stranger = $this->actingAs($this->owner)->postJson("/api/projects/{$other->id}/contacts", ['name' => 'Xavier', 'email' => 'x@y.test'], $this->headers)->json('data');

    automation(['recipient_ids' => [$stranger['id']]])->assertUnprocessable()->assertJsonValidationErrors('recipient_ids');
    automation(['weekday' => null])->assertUnprocessable()->assertJsonValidationErrors('weekday');
    automation(['channels' => ['sms']])->assertUnprocessable()->assertJsonValidationErrors('channels.0');
});

it('envia agora por e-mail e WhatsApp, só para quem consentiu, com PDF, link e descadastro', function () {
    $id = automation()->json('data.id');

    $run = $this->actingAs($this->owner)->postJson("/api/automations/{$id}/run", [], $this->headers)->assertCreated()->json('data');
    expect($run['status'])->toBe('sent')
        ->and($run['counts'])->toMatchArray(['read' => 1, 'sent' => 2, 'skipped' => 1]);

    Mail::assertSent(ReportMail::class, 2);
    Mail::assertSent(ReportMail::class, fn (ReportMail $mail) => $mail->hasTo('marina@padaria.test')
        && str_contains($mail->body, 'Olá, Marina!')
        && str_contains($mail->body, 'Investimento:')
        && str_starts_with($mail->url, 'http://localhost:4300/r/')
        && str_contains($mail->unsubscribeUrl, '/descadastrar?')
        && $mail->pdfPath !== null);

    $detail = $this->actingAs($this->owner)->getJson("/api/automation-runs/{$run['id']}", $this->headers)->json('data');
    $whatsapp = collect($detail['messages'])->where('channel', 'whatsapp')->keyBy('contact_name');

    expect($whatsapp['Marina Souza']['status'])->toBe('read') // demonstração: entregue e lido simulados
        ->and($whatsapp['Marina Souza']['provider'])->toBe('sandbox')
        ->and($whatsapp['Marina Souza']['body'])->toContain('/r/')->not->toMatch('#/r/[A-Za-z0-9]{40}#') // link mascarado no histórico
        ->and($whatsapp['João']['status'])->toBe('skipped')
        ->and($whatsapp['João']['error'])->toBe('Contato sem consentimento para WhatsApp.');
});

it('espera aprovação quando pedido e só então envia', function () {
    $id = automation(['requires_approval' => true])->json('data.id');
    $run = $this->actingAs($this->owner)->postJson("/api/automations/{$id}/run", [], $this->headers)->json('data');

    expect($run['status'])->toBe('awaiting_approval');
    Mail::assertNothingSent();
    $this->actingAs($this->owner)->getJson('/api/automation-runs?status=awaiting_approval', $this->headers)->assertJsonCount(1, 'data');

    $this->actingAs($this->owner)->postJson("/api/automation-runs/{$run['id']}/approve", [], $this->headers)->assertOk()->assertJsonPath('data.status', 'sent');
    Mail::assertSent(ReportMail::class, 2);
    $this->actingAs($this->owner)->postJson("/api/automation-runs/{$run['id']}/cancel", [], $this->headers)->assertStatus(409);
});

it('o agendador dispara os envios vencidos uma única vez', function () {
    $id = automation()->json('data.id');
    security()->run($this->tenant->id, $this->owner->id, fn () => DB::table('automations')->where('id', $id)->update(['next_run_at' => now()->subMinute()]));
    security()->clear();

    $this->artisan('automations:dispatch')->expectsOutputToContain('1 envio(s)')->assertSuccessful();
    $this->artisan('automations:dispatch')->expectsOutputToContain('0 envio(s)')->assertSuccessful();

    [$runs, $automation] = security()->run($this->tenant->id, $this->owner->id, fn () => [AutomationRun::query()->get(), Automation::query()->findOrFail($id)]);
    expect($runs)->toHaveCount(1)
        ->and($runs[0]->trigger)->toBe('schedule')
        ->and($runs[0]->status)->toBe('sent')
        ->and($automation->next_run_at->isFuture())->toBeTrue()
        ->and($automation->last_run_at)->not->toBeNull();
});

it('mostra a prévia da mensagem com os números do relatório', function () {
    $preview = $this->actingAs($this->owner)->postJson('/api/automations/preview', [
        'report_id' => $this->report['id'], 'period_preset' => 'last_7', 'message' => MessageComposer::DEFAULT_MESSAGE, 'contact_id' => $this->marina['id'],
    ], $this->headers)->assertOk()->json('data');

    expect($preview['text'])->toStartWith('Olá, Marina! O relatório de Padaria Aurora')->toContain('• Investimento: R$')
        ->and($preview['subject'])->toStartWith('Relatório Padaria Aurora · ')
        ->and($preview['whatsapp_params'])->toHaveCount(5)
        ->and(implode('', $preview['whatsapp_params']))->not->toContain("\n");
});

it('sincroniza todas as conexões de madrugada', function () {
    [$other, $otherOwner] = tenantWithOwner('Agência Boreal');
    connectSandbox($other, $otherOwner, 'instagram');
    security()->clear();

    $this->artisan('connections:sync-daily')->expectsOutputToContain('2 conexão(ões)')->assertSuccessful();

    $statuses = [
        ...asTenant($this->tenant, fn () => IntegrationConnection::query()->pluck('status')->all()),
        ...asTenant($other, fn () => IntegrationConnection::query()->pluck('status')->all()),
    ];
    expect($statuses)->toBe(['active', 'active']); // a fila "sync" dos testes já concluiu
});

it('não conta envio para quem tirou o consentimento no meio do caminho', function () {
    $id = automation(['channels' => ['email'], 'recipient_ids' => [$this->marina['id']]])->json('data.id');
    $run = $this->actingAs($this->owner)->postJson("/api/automations/{$id}/run", [], $this->headers)->json('data');

    expect(security()->run($this->tenant->id, $this->owner->id, fn () => Message::query()->where('run_id', $run['id'])->value('status')))->toBe('sent');
});
