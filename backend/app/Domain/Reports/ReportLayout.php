<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use App\Domain\Metrics\Catalog\MetricSet;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Estrutura de um relatório: seções com blocos. Tipos de bloco:
 *  kpis      grade de indicadores (1–12 métricas), com variação e semáforo
 *  chart     gráfico diário de uma métrica, com o período de comparação
 *  table     tabela de métricas com valor, anterior e variação (1–20)
 *  text      análise escrita pela agência (texto simples com **negrito**, listas e quebras)
 *  attention sinais do semáforo de atenção com sugestões (até N)
 *
 * normalize() é a única porta de entrada: valida contra as métricas da agência (catálogo +
 * indicadores personalizados), descarta campos desconhecidos e garante ids únicos.
 */
final class ReportLayout
{
    public const BLOCK_TYPES = ['kpis', 'chart', 'table', 'text', 'attention'];

    public const MAX_SECTIONS = 30;

    public const MAX_BLOCKS = 30;

    private const MAX_METRICS = ['kpis' => 12, 'table' => 20];

    private const MAX_TEXT = 5000;

    /**
     * @return array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}
     *
     * @throws ValidationException
     */
    public static function normalize(mixed $layout, MetricSet $set): array
    {
        $errors = [];
        $ids = [];
        $sections = is_array($layout) && is_array($layout['sections'] ?? null) ? $layout['sections'] : null;

        if ($sections === null) {
            throw ValidationException::withMessages(['layout' => 'Estrutura do relatório inválida.']);
        }
        if (count($sections) > self::MAX_SECTIONS) {
            throw ValidationException::withMessages(['layout' => 'O relatório pode ter no máximo '.self::MAX_SECTIONS.' seções.']);
        }

        $out = [];
        foreach (array_values($sections) as $s => $section) {
            $path = "layout.sections.{$s}";
            if (! is_array($section)) {
                $errors[$path] = 'Seção inválida.';

                continue;
            }

            $title = self::text($section['title'] ?? '', 80);
            if ($title === '') {
                $errors["{$path}.title"] = 'Dê um título para a seção.';
            }

            $blocks = is_array($section['blocks'] ?? null) ? array_values($section['blocks']) : [];
            if (count($blocks) > self::MAX_BLOCKS) {
                $errors["{$path}.blocks"] = 'Cada seção pode ter no máximo '.self::MAX_BLOCKS.' blocos.';
                $blocks = array_slice($blocks, 0, self::MAX_BLOCKS);
            }

            $normalized = [];
            foreach ($blocks as $b => $block) {
                $result = self::block(is_array($block) ? $block : [], "{$path}.blocks.{$b}", $set, $errors, $ids);
                if ($result !== null) {
                    $normalized[] = $result;
                }
            }

            $out[] = ['id' => self::id($section['id'] ?? null, 's', $ids), 'title' => $title, 'blocks' => $normalized];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return ['sections' => $out];
    }

    /**
     * @param  array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}  $layout
     * @return list<string> todas as métricas usadas, na ordem em que aparecem
     */
    public static function metricKeys(array $layout): array
    {
        $keys = [];
        foreach (self::blocks($layout) as $block) {
            $keys = [...$keys, ...self::blockMetrics($block)];
        }

        return array_values(array_unique($keys));
    }

    /**
     * @param  array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}  $layout
     * @return list<string> métricas que precisam de série diária (gráficos)
     */
    public static function chartKeys(array $layout): array
    {
        $keys = [];
        foreach (self::blocks($layout) as $block) {
            if ($block['type'] === 'chart' && is_string($block['metric'] ?? null)) {
                $keys[] = $block['metric'];
            }
        }

        return array_values(array_unique($keys));
    }

    /** @param array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>} $layout */
    public static function needsAttention(array $layout): bool
    {
        foreach (self::blocks($layout) as $block) {
            if ($block['type'] === 'attention' || $block['type'] === 'kpis') {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array{sections: list<array{id: string, title: string, blocks: list<array<string, mixed>>}>}  $layout
     * @return list<array<string, mixed>>
     */
    private static function blocks(array $layout): array
    {
        $all = [];
        foreach ($layout['sections'] as $section) {
            foreach ($section['blocks'] as $block) {
                $all[] = $block;
            }
        }

        return $all;
    }

    /**
     * @param  array<string, mixed>  $block
     * @return list<string>
     */
    private static function blockMetrics(array $block): array
    {
        $metrics = match ($block['type'] ?? null) {
            'kpis', 'table' => $block['metrics'] ?? [],
            'chart' => [$block['metric'] ?? null],
            default => [],
        };

        return array_values(array_filter(is_array($metrics) ? $metrics : [], 'is_string'));
    }

    /**
     * @param  array<mixed>  $block
     * @param  array<string, string>  $errors
     * @param  array<string, true>  $ids
     * @return array<string, mixed>|null
     */
    private static function block(array $block, string $path, MetricSet $set, array &$errors, array &$ids): ?array
    {
        $type = $block['type'] ?? null;
        if (! is_string($type) || ! in_array($type, self::BLOCK_TYPES, true)) {
            $errors["{$path}.type"] = 'Tipo de bloco desconhecido.';

            return null;
        }

        $base = ['id' => self::id($block['id'] ?? null, 'b', $ids), 'type' => $type];
        $title = self::text($block['title'] ?? '', 80);
        if ($title !== '') {
            $base['title'] = $title;
        }

        switch ($type) {
            case 'kpis':
            case 'table':
                $metrics = is_array($block['metrics'] ?? null) ? array_values(array_unique(array_filter($block['metrics'], 'is_string'))) : [];
                $max = self::MAX_METRICS[$type];
                if ($metrics === []) {
                    $errors["{$path}.metrics"] = 'Escolha ao menos uma métrica.';
                } elseif (count($metrics) > $max) {
                    $errors["{$path}.metrics"] = "Este bloco aceita no máximo {$max} métricas.";
                }
                foreach ($metrics as $key) {
                    if (! $set->has($key)) {
                        $errors["{$path}.metrics"] = "Métrica desconhecida: {$key}.";
                    }
                }

                return [...$base, 'metrics' => $metrics];

            case 'chart':
                $metric = $block['metric'] ?? null;
                if (! is_string($metric) || ! $set->has($metric)) {
                    $errors["{$path}.metric"] = 'Escolha a métrica do gráfico.';
                }

                return [...$base, 'metric' => is_string($metric) ? $metric : ''];

            case 'text':
                $content = is_string($block['content'] ?? null) ? str_replace("\r\n", "\n", $block['content']) : '';
                if (mb_strlen($content) > self::MAX_TEXT) {
                    $errors["{$path}.content"] = 'O texto pode ter no máximo '.self::MAX_TEXT.' caracteres.';
                }

                return [...$base, 'content' => $content];

            default: // attention
                $limit = $block['limit'] ?? 5;

                return [...$base, 'limit' => is_int($limit) ? max(1, min(10, $limit)) : 5];
        }
    }

    /** @param array<string, true> $ids */
    private static function id(mixed $candidate, string $prefix, array &$ids): string
    {
        $id = is_string($candidate) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $candidate) === 1 && ! isset($ids[$candidate])
            ? $candidate
            : $prefix.Str::lower(Str::random(8));

        $ids[$id] = true;

        return $id;
    }

    private static function text(mixed $value, int $max): string
    {
        return is_string($value) ? mb_substr(trim($value), 0, $max) : '';
    }
}
