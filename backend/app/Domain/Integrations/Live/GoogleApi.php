<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\ConnectorUnavailable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/** POST nas APIs do Google (GA4 Data, Google Ads) com os erros traduzidos. */
final class GoogleApi
{
    /** GET com a query já montada (o Google repete chaves: dailyMetrics=A&dailyMetrics=B). */
    public function get(string $url, string $query, string $token, string $provider): Response
    {
        return $this->handle(function () use ($url, $query, $token) {
            return Http::timeout(60)->acceptJson()->withToken($token)->get($query === '' ? $url : $url.'?'.$query);
        }, $provider);
    }

    /**
     * @param  array<string, mixed>  $body
     * @param  array<string, string>  $headers
     */
    public function post(string $url, array $body, string $token, string $provider, array $headers = []): Response
    {
        return $this->handle(fn () => Http::timeout(60)->acceptJson()->withToken($token)->withHeaders($headers)->post($url, $body), $provider);
    }

    /** @param callable(): Response $send */
    private function handle(callable $send, string $provider): Response
    {
        try {
            $response = $send();
        } catch (ConnectionException) {
            throw new LiveApiException('Não foi possível falar com o Google agora.');
        }

        if ($response->successful()) {
            return $response;
        }

        $status = $response->status();
        $detail = data_get($response->json(), '0.error.message') ?? $response->json('error.message');
        $text = is_string($detail) ? mb_substr($detail, 0, 200) : '';

        if ($status === 401) {
            throw ConnectorUnavailable::reauthorize($provider);
        }
        if (str_contains($response->body(), 'DEVELOPER_TOKEN_NOT_APPROVED') || str_contains($response->body(), 'DEVELOPER_TOKEN_PROHIBITED')) {
            throw new LiveApiException('O developer token do Google Ads ainda não tem acesso aprovado para contas reais (peça o acesso básico na Central de API).', retryable: false);
        }
        if ($status === 429 || $status >= 500) {
            throw new LiveApiException('Limite de chamadas do Google atingido; nova tentativa em instantes.');
        }

        throw new LiveApiException('O Google recusou a consulta'.($text !== '' ? ": {$text}" : '.'), retryable: false);
    }
}
