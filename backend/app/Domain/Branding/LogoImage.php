<?php

declare(strict_types=1);

namespace App\Domain\Branding;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Logo enviado pela agência: decodificado e RECODIFICADO em PNG (descarta metadados e qualquer
 * conteúdo embutido), redimensionado para caber em 600×200, com transparência preservada.
 */
final class LogoImage
{
    private const MAX_W = 600;

    private const MAX_H = 200;

    public static function store(UploadedFile $file, string $tenantId): string
    {
        $source = @imagecreatefromstring((string) file_get_contents($file->getRealPath()));
        if ($source === false) {
            throw ValidationException::withMessages(['logo' => 'Não foi possível ler a imagem. Use PNG, JPG ou WebP.']);
        }

        $w = imagesx($source);
        $h = imagesy($source);
        $scale = min(1, self::MAX_W / $w, self::MAX_H / $h);
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));

        $canvas = imagecreatetruecolor($nw, $nh);
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        $transparent = (int) imagecolorallocatealpha($canvas, 0, 0, 0, 127);
        imagefill($canvas, 0, 0, $transparent);
        imagecopyresampled($canvas, $source, 0, 0, 0, 0, $nw, $nh, $w, $h);

        ob_start();
        imagepng($canvas, null, 9);
        $png = (string) ob_get_clean();

        $path = "branding/{$tenantId}/logo.png";
        Storage::disk('local')->put($path, $png);

        return $path;
    }
}
