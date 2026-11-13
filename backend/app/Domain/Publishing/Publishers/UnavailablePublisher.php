<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Publishing\Networks;
use App\Models\Post;
use App\Models\PostTarget;

/** Rede ou formato sem publicação real pela API ainda: falha com a orientação, sem tentar de novo. */
final class UnavailablePublisher implements Publisher
{
    public function publish(Post $post, PostTarget $target, array $media): array
    {
        $label = Networks::SPEC[$target->network]['label'];

        throw new LiveApiException("A publicação automática em {$label} ({$target->format}) ainda não está disponível para contas reais. Publique manualmente e marque como publicado.", retryable: false);
    }
}
