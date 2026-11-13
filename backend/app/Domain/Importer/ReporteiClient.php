<?php

declare(strict_types=1);

namespace App\Domain\Importer;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/** Leitura da API v2 do Reportei (Bearer token da empresa), com paginação e limites respeitados. */
final class ReporteiClient
{
    public const BASE = 'https://app.reportei.com/api/v2';

    private const MAX_PAGES = 50;

    public function __construct(private readonly string $token) {}

    /** @return array<string, mixed> */
    public function settings(): array
    {
        return $this->get('/companies/settings');
    }

    /**
     * @param  array<string, scalar>  $query
     * @return list<array<string, mixed>>
     */
    public function all(string $path, array $query = []): array
    {
        $items = [];
        for ($page = 1; $page <= self::MAX_PAGES; $page++) {
            $body = $this->get($path, [...$query, 'page' => $page, 'per_page' => 100]);
            $data = $body['data'] ?? $body;
            $batch = is_array($data) ? array_values(array_filter($data, 'is_array')) : [];
            foreach ($batch as $item) {
                /** @var array<string, mixed> $item */
                $items[] = $item;
            }

            $last = data_get($body, 'meta.last_page') ?? data_get($body, 'last_page');
            if ($batch === [] || (is_numeric($last) && $page >= (int) $last) || (! is_numeric($last) && count($batch) < 100)) {
                break;
            }
        }

        return $items;
    }

    /**
     * @param  array<string, scalar>  $query
     * @return array<string, mixed>
     */
    private function get(string $path, array $query = []): array
    {
        try {
            $response = Http::timeout(30)->acceptJson()->withToken($this->token)->retry(2, 1000, throw: false)->get(self::BASE.$path, $query);
        } catch (ConnectionException) {
            throw new RuntimeException('Não foi possível falar com o Reportei agora.');
        }

        if ($response->status() === 401 || $response->status() === 403) {
            throw new RuntimeException('O Reportei recusou o token. Gere um novo em Configurações da Empresa no Reportei.');
        }
        if ($response->failed()) {
            throw new RuntimeException('O Reportei respondeu com erro (HTTP '.$response->status().').');
        }

        $json = $response->json();

        /** @var array<string, mixed> */
        return is_array($json) ? $json : [];
    }
}
