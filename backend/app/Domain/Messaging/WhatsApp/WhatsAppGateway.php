<?php

declare(strict_types=1);

namespace App\Domain\Messaging\WhatsApp;

use App\Models\WhatsAppAccount;
use Illuminate\Support\Str;

/**
 * Envio pelo WhatsApp da agência do contexto. Sem número configurado (ou em demonstração),
 * a mensagem é registrada como enviada pelo "sandbox": nada sai do Delta, e a entrega e a
 * leitura são simuladas para a jornada ficar completa.
 */
final readonly class WhatsAppGateway
{
    public function __construct(private MetaCloudWhatsApp $cloud) {}

    public function account(): ?WhatsAppAccount
    {
        return WhatsAppAccount::query()->first();
    }

    /**
     * @param  list<string>  $params
     * @return array{provider: 'meta_cloud'|'sandbox', id: string}
     */
    public function send(string $to, array $params): array
    {
        $account = $this->account();

        if ($account === null || $account->mode === 'sandbox') {
            return ['provider' => 'sandbox', 'id' => 'sandbox.'.Str::uuid7()];
        }

        return ['provider' => 'meta_cloud', 'id' => $this->cloud->send($account, $to, $params)];
    }

    /**
     * Resposta livre da caixa de entrada (janela de 24 h conferida por quem chama).
     *
     * @return array{provider: 'meta_cloud'|'sandbox', id: string}
     */
    public function reply(string $to, string $text): array
    {
        $account = $this->account();

        if ($account === null || $account->mode === 'sandbox') {
            return ['provider' => 'sandbox', 'id' => 'sandbox.'.Str::uuid7()];
        }

        return ['provider' => 'meta_cloud', 'id' => $this->cloud->sendText($account, $to, $text)];
    }
}
