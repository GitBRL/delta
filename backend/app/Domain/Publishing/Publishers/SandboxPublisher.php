<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use App\Models\Post;
use App\Models\PostTarget;
use Illuminate\Support\Str;

/** Conta em demonstração: a publicação é simulada, sem chamar a rede. */
final class SandboxPublisher implements Publisher
{
    public function publish(Post $post, PostTarget $target, array $media): array
    {
        return ['external_id' => 'sbx_'.$target->network.'_'.Str::lower(Str::random(12)), 'permalink' => null];
    }
}
