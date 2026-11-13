<?php

declare(strict_types=1);

namespace App\Domain\Sync;

use App\Domain\Integrations\Live\LiveApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Sheets API v4 com escopo drive.file: o Delta só enxerga as planilhas que ele mesmo criou.
 * ADR 0027.
 */
final class GoogleSheets
{
    public const API = 'https://sheets.googleapis.com/v4/spreadsheets';

    public const TAB = 'Dados';

    /** @return array{id: string, url: string} */
    public function create(string $token, string $title): array
    {
        $response = $this->send(fn () => $this->http($token)->post(self::API, [
            'properties' => ['title' => $title, 'locale' => 'pt_BR', 'timeZone' => 'America/Sao_Paulo'],
            'sheets' => [['properties' => ['title' => self::TAB, 'gridProperties' => ['frozenRowCount' => 1]]]],
        ])) ?? throw new LiveApiException('O Google não criou a planilha.', retryable: false);

        $id = $response->json('spreadsheetId');
        $url = $response->json('spreadsheetUrl');
        if (! is_string($id) || ! is_string($url)) {
            throw new LiveApiException('O Google não devolveu a planilha criada.', retryable: false);
        }

        return ['id' => $id, 'url' => $url];
    }

    /**
     * Substitui o conteúdo da aba de dados. Devolve false se a planilha não existe mais
     * (apagada no Drive): quem chamou cria outra.
     *
     * @param  list<list<string|float|null>>  $rows
     */
    public function replace(string $token, string $spreadsheetId, array $rows): bool
    {
        $base = self::API.'/'.rawurlencode($spreadsheetId).'/values/'.rawurlencode(self::TAB);

        $clear = $this->send(fn () => $this->http($token)->post($base.':clear'), allowMissing: true);
        if ($clear === null) {
            return false;
        }

        $this->send(fn () => $this->http($token)->put($base.'!A1?valueInputOption=USER_ENTERED', [
            'range' => self::TAB.'!A1',
            'majorDimension' => 'ROWS',
            'values' => array_map(fn (array $row): array => array_map(fn (string|float|null $v): string|float => $v ?? '', $row), $rows),
        ]));

        return true;
    }

    private function http(string $token): PendingRequest
    {
        return Http::timeout(30)->acceptJson()->withToken($token);
    }

    /** @param callable(): Response $request */
    private function send(callable $request, bool $allowMissing = false): ?Response
    {
        try {
            $response = $request();
        } catch (ConnectionException) {
            throw new LiveApiException('Não foi possível falar com o Google Sheets agora.');
        }

        if ($response->successful()) {
            return $response;
        }
        if ($allowMissing && $response->status() === 404) {
            return null;
        }
        if ($response->status() === 401) {
            throw new LiveApiException('O acesso ao Google expirou: reconecte o destino Google Sheets.', retryable: false);
        }
        if ($response->status() === 429 || $response->serverError()) {
            throw new LiveApiException('Limite de chamadas do Google Sheets atingido; nova tentativa em instantes.');
        }

        $message = $response->json('error.message');

        throw new LiveApiException('O Google Sheets recusou a gravação'.(is_string($message) ? ': '.mb_substr($message, 0, 200) : '.'), retryable: false);
    }
}
