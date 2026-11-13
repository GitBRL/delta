<?php

declare(strict_types=1);

namespace App\Domain\Messaging\WhatsApp;

use App\Models\WhatsAppAccount;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Cloud API oficial da Meta. Mensagem iniciada pela empresa = template aprovado na conta
 * (parâmetros do corpo: contato, cliente, período, destaques, link). Token no cabeçalho.
 */
final class MetaCloudWhatsApp
{
    /**
     * @param  list<string>  $params
     * @return string id da mensagem na Meta (wamid)
     */
    public function send(WhatsAppAccount $account, string $to, array $params): string
    {
        if ($account->phone_number_id === null || $account->access_token === null || $account->template_name === null) {
            throw new WhatsAppException('O WhatsApp da agência não está completo: confira o número, o token e o template.');
        }

        try {
            $response = Http::timeout(15)->acceptJson()->withToken($account->access_token)
                ->post(self::graph()."/{$account->phone_number_id}/messages", [
                    'messaging_product' => 'whatsapp',
                    'to' => ltrim($to, '+'),
                    'type' => 'template',
                    'template' => [
                        'name' => $account->template_name,
                        'language' => ['code' => $account->template_language],
                        'components' => [[
                            'type' => 'body',
                            'parameters' => array_map(fn (string $p): array => ['type' => 'text', 'text' => $p], $params),
                        ]],
                    ],
                ]);
        } catch (ConnectionException) {
            throw new WhatsAppException('Não foi possível falar com o WhatsApp agora.');
        }

        $id = $response->json('messages.0.id');
        if ($response->failed() || ! is_string($id)) {
            $detail = $response->json('error.error_data.details') ?? $response->json('error.message');

            throw new WhatsAppException('O WhatsApp recusou a mensagem'.(is_string($detail) ? ': '.mb_substr($detail, 0, 200) : '.'));
        }

        return $id;
    }

    /** Texto livre: só vale dentro da janela de 24 h desde a última mensagem do cliente. */
    public function sendText(WhatsAppAccount $account, string $to, string $text): string
    {
        try {
            $response = Http::timeout(15)->acceptJson()->withToken((string) $account->access_token)
                ->post(self::graph()."/{$account->phone_number_id}/messages", [
                    'messaging_product' => 'whatsapp',
                    'to' => ltrim($to, '+'),
                    'type' => 'text',
                    'text' => ['preview_url' => false, 'body' => $text],
                ]);
        } catch (ConnectionException) {
            throw new WhatsAppException('Não foi possível falar com o WhatsApp agora.');
        }

        $id = $response->json('messages.0.id');
        if ($response->failed() || ! is_string($id)) {
            throw new WhatsAppException('O WhatsApp recusou a resposta. Fora da janela de 24 horas, só templates aprovados podem ser enviados.');
        }

        return $id;
    }

    /** @return array{ok: bool, message: string, display_phone: string|null} */
    public function verify(WhatsAppAccount $account): array
    {
        try {
            $response = Http::timeout(10)->acceptJson()->withToken((string) $account->access_token)
                ->get(self::graph().'/'.rawurlencode((string) $account->phone_number_id), ['fields' => 'display_phone_number,verified_name,quality_rating']);
        } catch (ConnectionException) {
            return ['ok' => false, 'message' => 'Não foi possível falar com a Meta agora. Tente de novo em instantes.', 'display_phone' => null];
        }

        if ($response->failed()) {
            return ['ok' => false, 'message' => 'A Meta recusou o ID do número ou o token de acesso. Confira os dois no painel do WhatsApp Business.', 'display_phone' => null];
        }

        $phone = $response->json('display_phone_number');
        $name = $response->json('verified_name');

        return [
            'ok' => true,
            'message' => 'A Meta confirmou o número'.(is_string($phone) ? " {$phone}" : '').(is_string($name) ? " ({$name})" : '').'.',
            'display_phone' => is_string($phone) ? $phone : null,
        ];
    }

    private static function graph(): string
    {
        $version = config('services.meta.graph_version');

        return 'https://graph.facebook.com/'.(is_string($version) && $version !== '' ? $version : 'v24.0');
    }
}
