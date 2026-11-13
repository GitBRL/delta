<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostTarget;

/**
 * Publica um destino de um post numa rede (ADR 0028).
 * Lança LiveApiException (retentável ou não) ou ConnectorUnavailable (reautorizar a conta).
 * Pode lançar StillProcessing quando a rede ainda processa um vídeo: o job tenta de novo depois.
 */
interface Publisher
{
    /**
     * @param  list<MediaAsset>  $media
     * @return array{external_id: string, permalink: string|null}
     */
    public function publish(Post $post, PostTarget $target, array $media): array;
}
