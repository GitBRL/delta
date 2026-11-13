<?php

declare(strict_types=1);

namespace App\Domain\Publishing;

use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\PostTarget;

/**
 * Redes e formatos do Publishing, com as regras de cada um (ADR 0028). A conta de destino é uma
 * conta conectada do canal correspondente (perfil do Instagram, página do Facebook, canal do YouTube).
 */
final class Networks
{
    /** @var array<string, array{label: string, provider: string, formats: array<string, string>, caption_max: int}> */
    public const SPEC = [
        'instagram' => ['label' => 'Instagram', 'provider' => 'instagram', 'caption_max' => 2200, 'formats' => [
            'feed' => 'Feed (1 imagem ou vídeo)', 'carousel' => 'Carrossel (2 a 10 mídias)', 'reels' => 'Reels (1 vídeo)', 'story' => 'Story (1 mídia)',
        ]],
        'facebook' => ['label' => 'Facebook', 'provider' => 'facebook', 'caption_max' => 63206, 'formats' => [
            'feed' => 'Feed (texto, até 10 imagens ou 1 vídeo)', 'reels' => 'Reels (1 vídeo)', 'story' => 'Story (1 mídia)',
        ]],
        'youtube' => ['label' => 'YouTube', 'provider' => 'youtube', 'caption_max' => 5000, 'formats' => [
            'short' => 'Shorts (1 vídeo vertical)',
        ]],
    ];

    public const INSTAGRAM_HASHTAGS_MAX = 30;

    public const YOUTUBE_TITLE_MAX = 100;

    public static function providerFor(string $network): ?string
    {
        return self::SPEC[$network]['provider'] ?? null;
    }

    /** Rede de um canal conectado (instagram → instagram...). */
    public static function networkForProvider(string $provider): ?string
    {
        foreach (self::SPEC as $network => $spec) {
            if ($spec['provider'] === $provider) {
                return $network;
            }
        }

        return null;
    }

    /**
     * O que impede o post de ir para aprovação, agendamento ou publicação (vazio = pronto).
     *
     * @param  list<MediaAsset>  $media  na ordem do post
     * @param  iterable<PostTarget>  $targets
     * @return list<string>
     */
    public static function problems(Post $post, array $media, iterable $targets): array
    {
        $problems = [];
        $count = count($media);
        $videos = count(array_filter($media, fn (MediaAsset $m): bool => $m->kind === 'video'));
        $images = $count - $videos;
        $caption = $post->caption;
        $hasTargets = false;

        if ($count !== count($post->media)) {
            $problems[] = 'Alguma mídia do post não existe mais na biblioteca.';
        }

        foreach ($targets as $target) {
            $hasTargets = true;
            $spec = self::SPEC[$target->network];
            if (! isset($spec['formats'][$target->format])) {
                $problems[] = "Formato \"{$target->format}\" não existe para {$target->network}.";

                continue;
            }
            $where = $spec['label'].' ('.strtok($spec['formats'][$target->format], ' ').')';

            if ($target->account_id === null) {
                $problems[] = "{$where}: escolha a conta.";
            }
            if (mb_strlen($caption) > $spec['caption_max']) {
                $problems[] = "{$where}: a legenda passa de {$spec['caption_max']} caracteres.";
            }

            $problem = match ("{$target->network}.{$target->format}") {
                'instagram.feed' => $count !== 1 ? 'use exatamente 1 imagem ou vídeo.' : null,
                'instagram.carousel' => $count < 2 || $count > 10 ? 'use de 2 a 10 mídias.' : null,
                'instagram.reels', 'facebook.reels' => $count !== 1 || $videos !== 1 ? 'use exatamente 1 vídeo.' : null,
                'instagram.story', 'facebook.story' => $count !== 1 ? 'use exatamente 1 imagem ou vídeo.' : null,
                'facebook.feed' => $videos > 1 || ($videos === 1 && $images > 0) || $count > 10 ? 'use só texto, até 10 imagens ou 1 vídeo.' : ($count === 0 && trim($caption) === '' ? 'escreva o texto ou inclua mídia.' : null),
                'youtube.short' => $count !== 1 || $videos !== 1 ? 'use exatamente 1 vídeo.' : (trim((string) $post->title) === '' ? 'dê um título ao post (vira o título do vídeo).' : (mb_strlen((string) $post->title) > self::YOUTUBE_TITLE_MAX ? 'o título do vídeo tem no máximo 100 caracteres.' : null)),
                default => null,
            };
            if ($problem !== null) {
                $problems[] = "{$where}: {$problem}";
            }

            if ($target->network === 'instagram' && preg_match_all('/(?<!\w)#[\p{L}\p{N}_]+/u', $caption) > self::INSTAGRAM_HASHTAGS_MAX) {
                $problems[] = "{$where}: no máximo ".self::INSTAGRAM_HASHTAGS_MAX.' hashtags.';
            }
        }

        if (! $hasTargets) {
            $problems[] = 'Escolha ao menos uma rede.';
        }

        return array_values(array_unique($problems));
    }
}
