<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Live;

use App\Domain\Integrations\ConnectorUnavailable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/** Cliente da Graph API (Meta Ads, Páginas, Instagram): token no cabeçalho, paginação e erros traduzidos. */
final class MetaGraph
{
    private const RATE_LIMIT_CODES = [4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014];

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public function get(string $path, array $query, string $token, string $provider): array
    {
        /** @var array<string, mixed> */
        return $this->request(self::base().$path, $query, $token, $provider)->json() ?? [];
    }

    /**
     * @param  array<string, mixed>  $query
     * @return list<array<string, mixed>>
     */
    public function paginate(string $path, array $query, string $token, string $provider, int $maxPages = 100): array
    {
        $items = [];
        $url = self::base().$path;

        for ($page = 0; $page < $maxPages && $url !== null; $page++) {
            $response = $this->request($url, $query, $token, $provider);
            $data = $response->json('data');
            foreach (is_array($data) ? $data : [] as $item) {
                if (is_array($item)) {
                    /** @var array<string, mixed> $item */
                    $items[] = $item;
                }
            }

            $next = $response->json('paging.next');
            $url = is_string($next) ? $next : null;
            $query = []; // "next" já traz os parâmetros
        }

        return $items;
    }

    /**
     * Gravação (publicação de posts, ADR 0028).
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    public function post(string $path, array $body, string $token, string $provider): array
    {
        try {
            $response = Http::timeout(60)->acceptJson()->asForm()->withToken($token)->post(self::base().$path, array_map(
                fn (mixed $v): mixed => is_array($v) ? json_encode($v) : $v, $body,
            ));
        } catch (ConnectionException) {
            throw new LiveApiException('Não foi possível falar com a Meta agora.');
        }

        /** @var array<string, mixed> */
        return ($response->successful() ? $response : $this->fail($response, $provider))->json() ?? [];
    }

    /** @param array<string, mixed> $query */
    private function request(string $url, array $query, string $token, string $provider): Response
    {
        try {
            $response = Http::timeout(30)->acceptJson()->withToken($token)->get($url, $query);
        } catch (ConnectionException) {
            throw new LiveApiException('Não foi possível falar com a Meta agora.');
        }

        return $response->successful() ? $response : $this->fail($response, $provider);
    }

    private function fail(Response $response, string $provider): never
    {
        $code = $response->json('error.code');
        $message = $response->json('error.message');

        if ($code === 190 || $response->status() === 401) {
            throw ConnectorUnavailable::reauthorize($provider);
        }
        if ($code === 10 || (is_int($code) && $code >= 200 && $code < 300)) {
            throw new LiveApiException('A conta não deu ao Delta a permissão necessária (publicar ou ler). Reconecte-a aceitando todas as permissões pedidas.', retryable: false);
        }
        if (in_array($code, self::RATE_LIMIT_CODES, true) || $response->status() === 429 || $response->serverError()) {
            throw new LiveApiException('Limite de chamadas da Meta atingido; nova tentativa em instantes.');
        }

        throw new LiveApiException('A Meta recusou a consulta'.(is_string($message) ? ': '.mb_substr($message, 0, 200) : '.'), retryable: false);
    }

    private static function base(): string
    {
        $version = config('services.meta.graph_version');

        return 'https://graph.facebook.com/'.(is_string($version) && $version !== '' ? $version : 'v24.0');
    }
}
