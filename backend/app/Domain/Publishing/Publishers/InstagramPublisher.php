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
 * Instagram (Content Publishing API): cria o contêiner (ou os itens do carrossel), espera o vídeo
 * ficar pronto e publica. O id do contêiner fica nas opções do destino, então uma nova tentativa
 * não cria outro. Exige a permissão instagram_content_publish (App Review da Meta).
 */
final readonly class InstagramPublisher implements Publisher
{
    public function __construct(
        private MetaGraph $graph,
        private AccessTokens $tokens,
    ) {}

    public function publish(Post $post, PostTarget $target, array $media): array
    {
        $account = $target->account ?? throw new LiveApiException('O destino ficou sem conta do Instagram.', retryable: false);
        $token = $this->tokens->for($account->integration()->firstOrFail());
        $ig = $account->external_id;

        $container = is_string($target->options['container_id'] ?? null) ? $target->options['container_id'] : null;
        if ($container === null) {
            $container = $this->container($ig, $post, $target, $media, $token);
            $target->forceFill(['options' => [...$target->options, 'container_id' => $container]])->save();
        }

        $status = $this->graph->get("/{$container}", ['fields' => 'status_code'], $token, 'instagram')['status_code'] ?? 'FINISHED';
        if ($status === 'IN_PROGRESS') {
            throw new StillProcessing('O Instagram ainda está processando o vídeo.');
        }
        if ($status === 'ERROR' || $status === 'EXPIRED') {
            $target->forceFill(['options' => array_diff_key($target->options, ['container_id' => true])])->save();

            throw new LiveApiException('O Instagram não conseguiu processar a mídia (formato, duração ou proporção). Confira as especificações do formato.', retryable: false);
        }

        $published = $this->graph->post("/{$ig}/media_publish", ['creation_id' => $container], $token, 'instagram');
        $id = is_scalar($published['id'] ?? null) ? (string) $published['id'] : throw new LiveApiException('O Instagram não confirmou a publicação.');
        $permalink = $this->graph->get("/{$id}", ['fields' => 'permalink'], $token, 'instagram')['permalink'] ?? null;

        return ['external_id' => $id, 'permalink' => is_string($permalink) ? $permalink : null];
    }

    /** @param list<MediaAsset> $media */
    private function container(string $ig, Post $post, PostTarget $target, array $media, string $token): string
    {
        $item = fn (MediaAsset $m): array => $m->kind === 'video'
            ? ['media_type' => 'VIDEO', 'video_url' => MediaUrls::forPlatform($m)]
            : ['image_url' => MediaUrls::forPlatform($m)];

        $body = match ($target->format) {
            'carousel' => ['media_type' => 'CAROUSEL', 'caption' => $post->caption, 'children' => implode(',', array_map(
                fn (MediaAsset $m): string => $this->create($ig, [...$item($m), 'is_carousel_item' => 'true'], $token), $media,
            ))],
            'reels' => ['media_type' => 'REELS', 'video_url' => MediaUrls::forPlatform($media[0]), 'caption' => $post->caption, 'share_to_feed' => 'true'],
            'story' => [...($media[0]->kind === 'video' ? ['video_url' => MediaUrls::forPlatform($media[0])] : ['image_url' => MediaUrls::forPlatform($media[0])]), 'media_type' => 'STORIES'],
            // Vídeo no feed hoje é Reels para o Instagram.
            default => $media[0]->kind === 'video'
                ? ['media_type' => 'REELS', 'video_url' => MediaUrls::forPlatform($media[0]), 'caption' => $post->caption, 'share_to_feed' => 'true']
                : ['image_url' => MediaUrls::forPlatform($media[0]), 'caption' => $post->caption],
        };

        return $this->create($ig, $body, $token);
    }

    /** @param array<string, mixed> $body */
    private function create(string $ig, array $body, string $token): string
    {
        $created = $this->graph->post("/{$ig}/media", $body, $token, 'instagram');

        return is_scalar($created['id'] ?? null) ? (string) $created['id'] : throw new LiveApiException('O Instagram não criou o contêiner da mídia.');
    }
}
