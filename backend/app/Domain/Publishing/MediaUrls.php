<?php

declare(strict_types=1);

namespace App\Domain\Publishing;

use App\Models\MediaAsset;
use Illuminate\Support\Facades\URL;

/**
 * Endereços assinados de uma mídia (ADR 0028), com a agência embutida (a rota roda sem login):
 *  - para o app e a página de aprovação: relativo, 30 minutos (<img> não manda cabeçalhos);
 *  - para a rede baixar na publicação: absoluto (APP_URL), 6 horas.
 */
final class MediaUrls
{
    public static function forApp(MediaAsset $asset): string
    {
        return URL::temporarySignedRoute('media.public', now()->addMinutes(30), ['tenant' => $asset->tenant_id, 'asset' => $asset->id], absolute: false);
    }

    public static function forPlatform(MediaAsset $asset): string
    {
        $base = config('app.url');

        return rtrim(is_string($base) ? $base : '', '/').URL::temporarySignedRoute('media.public', now()->addHours(6), ['tenant' => $asset->tenant_id, 'asset' => $asset->id], absolute: false);
    }
}
