<?php

declare(strict_types=1);

namespace App\Domain\Publishing\Publishers;

use App\Domain\Integrations\Live\AccessTokens;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Integrations\Live\MetaGraph;
use App\Domain\Publishing\MediaUrls;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostTarget;

/**
 * Página do Facebook: feed com texto, até 10 fotos (enviadas sem publicar e anexadas) ou 1 vídeo,
 * com o token da página. Exige pages_manage_posts (App Review). Reels e Stories: em breve.
 */
final readonly class FacebookPublisher implements Publisher
{
    public function __construct(
        private MetaGraph $graph,
        private AccessTokens $tokens,
    ) {}

    public function publish(Post $post, PostTarget $target, array $media): array
    {
        if ($target->format !== 'feed') {
            return (new UnavailablePublisher)->publish($post, $target, $media);
        }

        $account = $target->account ?? throw new LiveApiException('O destino ficou sem página do Facebook.', retryable: false);
        $userToken = $this->tokens->for($account->integration()->firstOrFail());
        $page = $account->external_id;
        $pageToken = $this->graph->get("/{$page}", ['fields' => 'access_token'], $userToken, 'facebook')['access_token'] ?? null;
        $token = is_string($pageToken) ? $pageToken : $userToken;

        $result = match (true) {
            $media === [] => $this->graph->post("/{$page}/feed", ['message' => $post->caption], $token, 'facebook'),
            $media[0]->kind === 'video' => $this->graph->post("/{$page}/videos", ['file_url' => MediaUrls::forPlatform($media[0]), 'description' => $post->caption], $token, 'facebook'),
            count($media) === 1 => $this->graph->post("/{$page}/photos", ['url' => MediaUrls::forPlatform($media[0]), 'caption' => $post->caption], $token, 'facebook'),
            default => $this->graph->post("/{$page}/feed", ['message' => $post->caption, 'attached_media' => array_map(
                fn (MediaAsset $m): array => ['media_fbid' => $this->unpublishedPhoto($page, $m, $token)], $media,
            )], $token, 'facebook'),
        };

        $id = $result['post_id'] ?? $result['id'] ?? null;
        $id = is_scalar($id) ? (string) $id : throw new LiveApiException('O Facebook não confirmou a publicação.');

        return ['external_id' => $id, 'permalink' => "https://www.facebook.com/{$id}"];
    }

    private function unpublishedPhoto(string $page, MediaAsset $m, string $token): string
    {
        $photo = $this->graph->post("/{$page}/photos", ['url' => MediaUrls::forPlatform($m), 'published' => 'false'], $token, 'facebook');

        return is_scalar($photo['id'] ?? null) ? (string) $photo['id'] : throw new LiveApiException('O Facebook não recebeu uma das fotos.');
    }
}
