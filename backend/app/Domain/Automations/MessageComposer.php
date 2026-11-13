<?php

declare(strict_types=1);

namespace App\Domain\Automations;

use App\Domain\Reports\Pdf\MetricFormat;
use App\Models\Contact;

/**
 * Texto das mensagens a partir do modelo da automação. Variáveis:
 *  {{contato}} primeiro nome · {{cliente}} projeto · {{periodo}} · {{agencia}} · {{link}} · {{resumo}}
 * O resumo sai do primeiro bloco de KPIs publicado (até 5 métricas, com variação e semáforo).
 */
final class MessageComposer
{
    public const DEFAULT_MESSAGE = "Olá, {{contato}}! O relatório de {{cliente}} ({{periodo}}) está pronto.\n\n{{resumo}}\n\nVeja o relatório completo: {{link}}";

    public const VARIABLES = ['contato', 'cliente', 'periodo', 'agencia', 'link', 'resumo'];

    private const STATUS_ICON = ['critical' => '🔴', 'attention' => '🟡', 'opportunity' => '🔵'];

    /** @param array<string, mixed> $data dados do snapshot */
    public static function render(string $template, ?Contact $contact, array $data, string $link): string
    {
        $values = self::values($contact, $data, $link, multiline: true);

        return trim((string) preg_replace_callback('/\{\{\s*([a-z]+)\s*\}\}/', fn (array $m): string => $values[$m[1]] ?? $m[0], $template));
    }

    /**
     * Parâmetros do template aprovado na Meta, em ordem: contato, cliente, período, destaques, link.
     * A Meta não aceita quebra de linha nem 4+ espaços seguidos dentro de parâmetros.
     *
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    public static function templateParams(?Contact $contact, array $data, string $link): array
    {
        $v = self::values($contact, $data, $link, multiline: false);

        return array_map(fn (string $s): string => mb_substr(trim((string) preg_replace('/\s+/', ' ', $s)), 0, 900), [$v['contato'], $v['cliente'], $v['periodo'], $v['resumo'], $v['link']]);
    }

    /** @param array<string, mixed> $data */
    public static function subject(array $data): string
    {
        $project = is_array($data['project'] ?? null) && is_string($data['project']['name'] ?? null) ? $data['project']['name'] : 'seu projeto';
        $period = is_array($data['period'] ?? null) && is_string($data['period']['label'] ?? null) ? $data['period']['label'] : '';

        return trim("Relatório {$project} · {$period}", ' ·');
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, string>
     */
    private static function values(?Contact $contact, array $data, string $link, bool $multiline): array
    {
        $first = $contact !== null ? explode(' ', trim($contact->name))[0] : '';
        $project = is_array($data['project'] ?? null) ? ($data['project']['name'] ?? '') : '';
        $period = is_array($data['period'] ?? null) ? ($data['period']['label'] ?? '') : '';
        $lines = self::summary($data);

        return [
            'contato' => $first !== '' ? $first : 'tudo bem',
            'cliente' => is_string($project) ? $project : '',
            'periodo' => is_string($period) ? $period : '',
            'agencia' => is_string($data['agency'] ?? null) ? $data['agency'] : '',
            'link' => $link,
            'resumo' => $lines === [] ? '' : ($multiline ? implode("\n", array_map(fn (string $l): string => "• {$l}", $lines)) : implode(' · ', $lines)),
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    private static function summary(array $data): array
    {
        foreach (is_array($data['sections'] ?? null) ? $data['sections'] : [] as $section) {
            foreach (is_array($section) && is_array($section['blocks'] ?? null) ? $section['blocks'] : [] as $block) {
                if (! is_array($block) || ($block['type'] ?? null) !== 'kpis' || ! is_array($block['metrics'] ?? null) || $block['metrics'] === []) {
                    continue;
                }

                $lines = [];
                foreach (array_slice($block['metrics'], 0, 5) as $m) {
                    if (! is_array($m)) {
                        continue;
                    }
                    $unit = is_string($m['unit'] ?? null) ? $m['unit'] : 'count';
                    $decimals = is_int($m['decimals'] ?? null) ? $m['decimals'] : null;
                    $label = is_string($m['label'] ?? null) ? $m['label'] : '';
                    $change = ($data['compare'] ?? 'none') !== 'none' ? MetricFormat::change($m['change_pct'] ?? null) : '';
                    $icon = self::STATUS_ICON[is_string($m['status'] ?? null) ? $m['status'] : ''] ?? '';

                    $lines[] = trim("{$label}: ".MetricFormat::value($m['value'] ?? null, $unit, $decimals).($change !== '' ? " ({$change})" : '')." {$icon}");
                }

                return $lines;
            }
        }

        return [];
    }
}
