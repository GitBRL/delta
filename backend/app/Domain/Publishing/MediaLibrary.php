<?php

declare(strict_types=1);

namespace App\Domain\Publishing;

use App\Models\MediaAsset;
use App\Support\Tenancy\TenantContext;
use finfo;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Upload da biblioteca de mídia (ADR 0028).
 *  - Imagens: o tipo real é conferido pelo conteúdo; são decodificadas e RECODIFICADAS em JPEG
 *    (formato exigido pelo Instagram; descarta metadados e conteúdo embutido), no máximo 2160 px.
 *  - Vídeos: MP4 ou MOV conferidos pelo conteúdo e guardados como vieram.
 */
final readonly class MediaLibrary
{
    public const DISK = 'local';

    public const MAX_SIDE = 2160;

    private const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];

    private const VIDEOS = ['video/mp4' => 'mp4', 'video/quicktime' => 'mov'];

    public function __construct(private TenantContext $context) {}

    public function store(UploadedFile $file, ?string $projectId): MediaAsset
    {
        $path = (string) $file->getRealPath();
        $mime = $path === '' ? false : (new finfo(FILEINFO_MIME_TYPE))->file($path);
        $tenant = (string) $this->context->tenantId();
        $id = (string) Str::uuid7();

        if (in_array($mime, self::IMAGES, true)) {
            [$bytes, $width, $height] = self::jpeg($path);
            $stored = "media/{$tenant}/{$id}.jpg";
            $kind = 'image';
            $mime = 'image/jpeg';
        } elseif (is_string($mime) && isset(self::VIDEOS[$mime])) {
            $bytes = (string) file_get_contents($path);
            $stored = "media/{$tenant}/{$id}.".self::VIDEOS[$mime];
            $kind = 'video';
            $width = $height = null;
        } else {
            throw ValidationException::withMessages(['file' => 'Use imagem JPG, PNG ou WebP, ou vídeo MP4 ou MOV.']);
        }

        Storage::disk(self::DISK)->put($stored, $bytes);

        $asset = new MediaAsset([
            'project_id' => $projectId,
            'kind' => $kind,
            'path' => $stored,
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
            'mime' => $mime,
            'size_bytes' => strlen($bytes),
            'width' => $width,
            'height' => $height,
            'checksum' => hash('sha256', $bytes),
            'created_by' => $this->context->userId(),
        ]);
        $asset->id = $id; // o nome do arquivo usa o mesmo id
        $asset->save();

        return $asset;
    }

    /** @return array{0: string, 1: int, 2: int} */
    private static function jpeg(string $path): array
    {
        $source = @imagecreatefromstring((string) file_get_contents($path));
        if ($source === false) {
            throw ValidationException::withMessages(['file' => 'Não foi possível ler a imagem.']);
        }

        $w = imagesx($source);
        $h = imagesy($source);
        $scale = min(1, self::MAX_SIDE / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));

        // Fundo branco: JPEG não tem transparência.
        $canvas = imagecreatetruecolor($nw, $nh);
        imagefill($canvas, 0, 0, (int) imagecolorallocate($canvas, 255, 255, 255));
        imagecopyresampled($canvas, $source, 0, 0, 0, 0, $nw, $nh, $w, $h);

        ob_start();
        imagejpeg($canvas, null, 90);

        return [(string) ob_get_clean(), $nw, $nh];
    }
}
