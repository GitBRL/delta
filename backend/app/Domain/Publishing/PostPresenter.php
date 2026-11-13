<?php

declare(strict_types=1);

namespace App\Domain\Publishing;

use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostApproval;
use App\Models\PostTarget;

/** Formato do post para o app (equipe e cliente) e para a página pública de aprovação. */
final readonly class PostPresenter
{
    public function __construct(private PublishingService $publishing) {}

    /** @return array<string, mixed> */
    public function present(Post $post, bool $staff = true): array
    {
        $media = $this->publishing->media($post);
        $targets = $post->targets()->with('account.integration')->get();
        $approval = $staff ? PostApproval::query()->where('post_id', $post->id)->latest('created_at')->first() : null;

        return [
            'id' => $post->id,
            'project' => ['id' => $post->project_id, 'name' => $post->project?->name],
            'title' => $post->title,
            'caption' => $post->caption,
            'media' => array_map(self::media(...), $media),
            'status' => $post->status,
            'requires_approval' => $post->requires_approval,
            'scheduled_at' => $post->scheduled_at?->toIso8601String(),
            'published_at' => $post->published_at?->toIso8601String(),
            'external_reference' => $post->external_reference,
            'targets' => $targets->map(fn (PostTarget $t): array => [
                'id' => $t->id,
                'network' => $t->network,
                'format' => $t->format,
                'account' => $t->account === null ? null : [
                    'id' => $t->account->id, 'name' => $t->account->name, 'mode' => $t->account->integration?->mode,
                ],
                'status' => $t->status,
                'permalink' => $t->permalink,
                'error' => $t->error,
                'published_at' => $t->published_at?->toIso8601String(),
            ])->values()->all(),
            'problems' => Networks::problems($post, $media, $targets),
            'approval' => $approval === null ? null : [
                'link' => PublishingService::approvalLink($approval->token),
                'active' => $approval->decided_at === null && $approval->expires_at->isFuture(),
                'expires_at' => $approval->expires_at->toIso8601String(),
                'decided_at' => $approval->decided_at?->toIso8601String(),
                'decision' => $approval->decision,
                'comment' => $approval->comment,
                'decided_by_name' => $approval->decided_by_name,
                'notified' => $approval->notified,
            ],
            'created_at' => $post->created_at?->toIso8601String(),
            'updated_at' => $post->updated_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    public static function media(MediaAsset $m): array
    {
        return [
            'id' => $m->id, 'kind' => $m->kind, 'mime' => $m->mime, 'url' => MediaUrls::forApp($m),
            'width' => $m->width, 'height' => $m->height, 'size_bytes' => $m->size_bytes, 'original_name' => $m->original_name,
            'project_id' => $m->project_id, 'created_at' => $m->created_at?->toIso8601String(),
        ];
    }
}
