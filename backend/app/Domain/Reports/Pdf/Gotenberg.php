<?php

declare(strict_types=1);

namespace App\Domain\Reports\Pdf;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/** Converte HTML estático em PDF A4 pelo Gotenberg (Chromium sem JavaScript e sem rede). */
final class Gotenberg
{
    /**
     * @param  array<string, string>  $assets  arquivos extras referenciados pelo HTML (nome => conteúdo)
     * @param  array<string, string>  $paper  sobrescreve o papel e as margens (padrão A4 retrato)
     */
    public function htmlToPdf(string $html, string $footer, array $assets = [], array $paper = []): string
    {
        $base = config('services.gotenberg.url');
        $url = rtrim(is_string($base) && $base !== '' ? $base : 'http://gotenberg:3000', '/').'/forms/chromium/convert/html';

        try {
            $request = Http::timeout(90)
                ->attach('files', $html, 'index.html', ['Content-Type' => 'text/html'])
                ->attach('files', $footer, 'footer.html', ['Content-Type' => 'text/html']);
            foreach ($assets as $name => $contents) {
                $request = $request->attach('files', $contents, $name);
            }
            $response = $request->post($url, [
                'paperWidth' => '8.27',
                'paperHeight' => '11.7',
                'marginTop' => '0.45',
                'marginBottom' => '0.6',
                'marginLeft' => '0.45',
                'marginRight' => '0.45',
                'printBackground' => 'true',
                ...$paper, // Studio: paisagem 16:9
            ]);
        } catch (ConnectionException $e) {
            throw new RuntimeException('Gerador de PDF indisponível: '.$e->getMessage(), 0, $e);
        }

        if ($response->failed() || ! str_starts_with($response->body(), '%PDF')) {
            throw new RuntimeException('O gerador de PDF recusou o documento (HTTP '.$response->status().').');
        }

        return $response->body();
    }
}
