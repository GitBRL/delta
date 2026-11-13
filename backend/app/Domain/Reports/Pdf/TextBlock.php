<?php

declare(strict_types=1);

namespace App\Domain\Reports\Pdf;

/**
 * Texto de análise → HTML seguro. Tudo é escapado ANTES; depois só três marcações viram tags:
 * **negrito**, linhas "- item" (lista) e linhas em branco (parágrafos). Nada de HTML do usuário.
 */
final class TextBlock
{
    public static function toHtml(string $text): string
    {
        $html = '';
        foreach (preg_split('/\n\s*\n/', trim($text)) ?: [] as $chunk) {
            $lines = explode("\n", $chunk);
            $isList = array_filter($lines, fn (string $l): bool => preg_match('/^\s*[-•]\s+/', $l) !== 1) === [];

            if ($isList) {
                $items = array_map(fn (string $l): string => '<li>'.self::inline((string) preg_replace('/^\s*[-•]\s+/', '', $l)).'</li>', $lines);
                $html .= '<ul>'.implode('', $items).'</ul>';
            } else {
                $html .= '<p>'.implode('<br>', array_map(self::inline(...), $lines)).'</p>';
            }
        }

        return $html;
    }

    private static function inline(string $line): string
    {
        $escaped = htmlspecialchars($line, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

        return (string) preg_replace('/\*\*(.+?)\*\*/u', '<strong>$1</strong>', $escaped);
    }
}
