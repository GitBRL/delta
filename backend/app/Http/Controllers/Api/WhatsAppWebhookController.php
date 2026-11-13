<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Contacts\Contacts;
use App\Domain\Messaging\MessageStatus;
use App\Domain\Messaging\WhatsApp\InboxRecorder;
use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\Message;
use App\Models\WhatsAppAccount;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Webhook da Cloud API do WhatsApp (Meta):
 *  GET  verificação (hub.verify_token de alguma agência)
 *  POST status das mensagens (enviada, entregue, lida, falhou) e respostas "PARAR"
 * A agência sai do phone_number_id (função estreita); a assinatura X-Hub-Signature-256 é
 * conferida com o app secret DAQUELA agência antes de qualquer gravação. Ver ADR 0013.
 */
final class WhatsAppWebhookController extends Controller
{
    private const STOP_WORDS = ['PARAR', 'SAIR', 'STOP', 'CANCELAR', 'DESCADASTRAR', 'NAO QUERO', 'NÃO QUERO'];

    public function __construct(
        private readonly TenantContext $context,
        private readonly Contacts $contacts,
    ) {}

    public function verify(Request $request): Response
    {
        $token = $request->query('hub_verify_token');
        $valid = $request->query('hub_mode') === 'subscribe' && is_string($token)
            && DB::scalar('select app.whatsapp_verify_token_valid(?)', [hash('sha256', $token)]) === true;

        return $valid ? response((string) $request->query('hub_challenge'), 200, ['Content-Type' => 'text/plain']) : response('', 403);
    }

    public function receive(Request $request): Response
    {
        $raw = $request->getContent();
        $entries = $request->json('entry');

        foreach (is_array($entries) ? $entries : [] as $entry) {
            foreach (is_array($entry) && is_array($entry['changes'] ?? null) ? $entry['changes'] : [] as $change) {
                $value = is_array($change) && is_array($change['value'] ?? null) ? $change['value'] : [];
                $phoneId = data_get($value, 'metadata.phone_number_id');
                $tenantId = is_string($phoneId) ? DB::scalar('select app.whatsapp_tenant_by_phone(?)', [$phoneId]) : null;

                if (! is_string($tenantId)) {
                    continue;
                }

                $this->context->run($tenantId, null, function () use ($request, $raw, $value): void {
                    $account = WhatsAppAccount::query()->first();
                    if ($account === null || ! self::signed($request, $raw, (string) $account->app_secret)) {
                        Log::warning('Webhook do WhatsApp com assinatura inválida', ['phone_number_id' => $account?->phone_number_id]);

                        return;
                    }

                    $this->statuses(is_array($value['statuses'] ?? null) ? $value['statuses'] : []);
                    $this->inbound(is_array($value['messages'] ?? null) ? $value['messages'] : [], $request->ip());
                });
            }
        }

        return response('', 200); // a Meta reenvia em caso de erro; o que não é nosso é ignorado
    }

    /** @param array<mixed> $statuses */
    private function statuses(array $statuses): void
    {
        foreach ($statuses as $status) {
            if (! is_array($status) || ! is_string($status['id'] ?? null) || ! is_string($status['status'] ?? null)) {
                continue;
            }

            $message = Message::query()->where('provider_message_id', $status['id'])->first();
            if ($message === null) {
                continue;
            }

            $at = is_numeric($status['timestamp'] ?? null) ? CarbonImmutable::createFromTimestamp((int) $status['timestamp']) : null;
            $error = data_get($status, 'errors.0.title') ?? data_get($status, 'errors.0.message');
            MessageStatus::advance($message, $status['status'], $at, is_string($error) ? $error : null);
        }
    }

    /** @param array<mixed> $messages */
    private function inbound(array $messages, ?string $ip): void
    {
        foreach ($messages as $incoming) {
            $text = data_get($incoming, 'text.body') ?? data_get($incoming, 'button.text');
            $from = is_array($incoming) ? ($incoming['from'] ?? null) : null;
            if (! is_string($text) || ! is_string($from)) {
                continue;
            }

            $phone = '+'.ltrim($from, '+');
            $id = data_get($incoming, 'id');
            InboxRecorder::received($phone, $text, is_string($id) ? $id : null);

            if (in_array(mb_strtoupper(trim($text)), self::STOP_WORDS, true)) {
                foreach (Contact::query()->where('phone', $phone)->get() as $contact) {
                    $this->contacts->optOut($contact, 'whatsapp', 'whatsapp_reply', $ip);
                }
            }
        }
    }

    private static function signed(Request $request, string $raw, string $secret): bool
    {
        $header = $request->header('X-Hub-Signature-256');

        return $secret !== '' && is_string($header) && hash_equals('sha256='.hash_hmac('sha256', $raw, $secret), $header);
    }
}
