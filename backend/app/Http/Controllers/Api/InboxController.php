<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Billing\Entitlements;
use App\Domain\Billing\PlanLimitException;
use App\Domain\Contacts\Phone;
use App\Domain\Messaging\WhatsApp\InboxRecorder;
use App\Domain\Messaging\WhatsApp\WhatsAppException;
use App\Domain\Messaging\WhatsApp\WhatsAppGateway;
use App\Http\Controllers\Controller;
use App\Models\Contact;
use App\Models\WhatsAppMessage;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Caixa de respostas do WhatsApp (equipe). Conversas por telefone; resposta livre só dentro da
 * janela de 24 h desde a última mensagem do cliente (regra da Meta). ADR 0023.
 */
final class InboxController extends Controller
{
    public const WINDOW_HOURS = 24;

    public function __construct(
        private readonly WhatsAppGateway $gateway,
        private readonly TenantContext $context,
    ) {}

    public function index(): JsonResponse
    {
        $messages = WhatsAppMessage::query()->with('contact:id,name,project_id')->orderByDesc('created_at')->limit(1000)->get();
        $conversations = [];

        foreach ($messages as $m) {
            $c = $conversations[$m->phone] ?? null;
            if ($c === null) {
                $conversations[$m->phone] = [
                    'phone' => $m->phone,
                    'phone_display' => Phone::display($m->phone),
                    'contact' => $m->contact === null ? null : ['id' => $m->contact->id, 'name' => $m->contact->name, 'project_id' => $m->contact->project_id],
                    'last_message' => ['direction' => $m->direction, 'body' => mb_substr($m->body, 0, 140), 'created_at' => $m->created_at?->toIso8601String()],
                    'unread' => 0,
                    'window_open' => false,
                ];
            }
            if ($m->direction === 'in') {
                $conversations[$m->phone]['unread'] += $m->read_at === null ? 1 : 0;
                $conversations[$m->phone]['window_open'] = $conversations[$m->phone]['window_open'] || self::open($m->created_at);
            }
        }

        // O modo vai junto para a equipe (o GET /api/whatsapp é só de dono/admin): a simulação só existe em demonstração.
        return response()->json(['data' => array_values($conversations), 'meta' => ['mode' => $this->gateway->account()->mode ?? 'sandbox']]);
    }

    public function show(string $phone): JsonResponse
    {
        $e164 = self::phone($phone);
        $messages = WhatsAppMessage::query()->where('phone', $e164)->orderBy('created_at')->limit(500)->get();
        WhatsAppMessage::query()->where('phone', $e164)->where('direction', 'in')->whereNull('read_at')->update(['read_at' => now()]);
        $contact = Contact::query()->where('phone', $e164)->first(['id', 'name', 'project_id']);
        $lastIn = $messages->where('direction', 'in')->last();

        return response()->json(['data' => [
            'phone' => $e164,
            'phone_display' => Phone::display($e164),
            'contact' => $contact === null ? null : ['id' => $contact->id, 'name' => $contact->name, 'project_id' => $contact->project_id],
            'window_open' => $lastIn !== null && self::open($lastIn->created_at),
            'window_closes_at' => $lastIn?->created_at?->copy()->addHours(self::WINDOW_HOURS)->toIso8601String(),
            'messages' => $messages->map(fn (WhatsAppMessage $m): array => [
                'id' => $m->id, 'direction' => $m->direction, 'body' => $m->body, 'status' => $m->status, 'created_at' => $m->created_at?->toIso8601String(),
            ])->values()->all(),
        ]]);
    }

    public function reply(Request $request, string $phone): JsonResponse
    {
        $request->validate(['text' => ['required', 'string', 'min:1', 'max:4096']], ['text.required' => 'Escreva a resposta.']);
        $e164 = self::phone($phone);
        $lastIn = WhatsAppMessage::query()->where('phone', $e164)->where('direction', 'in')->orderByDesc('created_at')->first();

        if ($lastIn === null || ! self::open($lastIn->created_at)) {
            throw ValidationException::withMessages(['text' => 'Fora da janela de 24 horas desde a última mensagem do cliente: pelas regras do WhatsApp, só templates aprovados podem ser enviados agora.']);
        }

        if (app(Entitlements::class)->remaining('whatsapp_messages') === 0) {
            throw new PlanLimitException('A franquia de mensagens de WhatsApp do mês acabou. Mude de plano em Configurações › Plano.', 'whatsapp_messages');
        }

        try {
            $sent = $this->gateway->reply($e164, $request->string('text')->toString());
        } catch (WhatsAppException $e) {
            throw ValidationException::withMessages(['text' => $e->getMessage()]);
        }

        $message = WhatsAppMessage::query()->create([
            'contact_id' => $lastIn->contact_id,
            'phone' => $e164,
            'direction' => 'out',
            'body' => $request->string('text')->toString(),
            'provider_message_id' => $sent['id'],
            'status' => 'sent',
            'sent_by' => $this->context->userId(),
            'created_at' => now(),
        ]);

        return response()->json(['data' => ['id' => $message->id, 'direction' => 'out', 'body' => $message->body, 'status' => 'sent', 'created_at' => $message->created_at?->toIso8601String()]], 201);
    }

    /** Só no modo demonstração: simula a mensagem de um cliente para testar a caixa de respostas. */
    public function simulate(Request $request): JsonResponse
    {
        abort_if(($this->gateway->account()->mode ?? 'sandbox') !== 'sandbox', 422, 'A simulação só existe no modo demonstração.');
        $request->validate(['phone' => ['required', 'string', 'max:30'], 'text' => ['required', 'string', 'max:1000']]);

        $phone = Phone::normalize($request->string('phone')->toString()) ?? throw ValidationException::withMessages(['phone' => 'Telefone inválido.']);
        $message = InboxRecorder::received($phone, $request->string('text')->toString(), 'sandbox.in.'.uniqid());

        return response()->json(['data' => ['id' => $message?->id, 'phone' => $phone]], 201);
    }

    private static function phone(string $raw): string
    {
        return Phone::normalize('+'.ltrim($raw, '+')) ?? abort(404, 'Conversa não encontrada.');
    }

    private static function open(?CarbonInterface $receivedAt): bool
    {
        return $receivedAt !== null && CarbonImmutable::parse($receivedAt)->addHours(self::WINDOW_HOURS)->isFuture();
    }
}
