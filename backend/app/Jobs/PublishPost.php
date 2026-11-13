<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Domain\Publishing\PublishingService;
use App\Models\Post;
use App\Support\Tenancy\TenantScopedJob;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Publica um post agendado (ADR 0028), no contexto da agência. Enquanto alguma rede processa um
 * vídeo, o job volta para a fila em 30 s (até ~15 min); o que já saiu não sai de novo.
 */
final class PublishPost implements ShouldBeUnique, ShouldQueue
{
    use Queueable, TenantScopedJob;

    public int $tries = 30;

    public int $uniqueFor = 1800;

    public function __construct(public readonly string $postId)
    {
        $this->captureTenantContext();
        $this->onQueue('publish');
    }

    public function uniqueId(): string
    {
        return $this->postId;
    }

    public function handle(PublishingService $publishing): void
    {
        $post = Post::query()->find($this->postId);
        if ($post === null) {
            return;
        }

        if ($publishing->publish($post) && $this->attempts() < $this->tries) {
            $this->release(30);
        }
    }
}
