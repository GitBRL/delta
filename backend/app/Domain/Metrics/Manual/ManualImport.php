<?php

declare(strict_types=1);

namespace App\Domain\Metrics\Manual;

use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;

/**
 * Lê uma planilha colada ou exportada em CSV: "data;valor" por linha (cabeçalho opcional).
 * Aceita datas dd/mm/aaaa ou aaaa-mm-dd, números 1.234,56 ou 1234.56, separador ; , ou tab.
 */
final class ManualImport
{
    public const MAX_ROWS = 2000;

    /** @return array{rows: list<array{date: string, value: float}>, errors: list<array{line: int, message: string}>} */
    public static function parse(string $csv): array
    {
        $rows = [];
        $errors = [];
        $lines = preg_split('/\r\n|\r|\n/', trim($csv)) ?: [];

        foreach ($lines as $i => $line) {
            $number = $i + 1;
            if (trim($line) === '') {
                continue;
            }
            if (count($rows) >= self::MAX_ROWS) {
                $errors[] = ['line' => $number, 'message' => 'Limite de '.self::MAX_ROWS.' linhas por importação.'];
                break;
            }

            $cells = self::cells($line);
            if (count($cells) < 2) {
                $errors[] = ['line' => $number, 'message' => 'Use "data;valor".'];

                continue;
            }

            $date = self::date($cells[0]);
            $value = self::number($cells[1]);

            if ($date === null && $value === null && $i === 0) {
                continue; // cabeçalho
            }
            if ($date === null) {
                $errors[] = ['line' => $number, 'message' => "Data inválida: \"{$cells[0]}\" (use 31/10/2026 ou 2026-10-31)."];

                continue;
            }
            if ($value === null) {
                $errors[] = ['line' => $number, 'message' => "Valor inválido: \"{$cells[1]}\"."];

                continue;
            }

            $rows[] = ['date' => $date, 'value' => $value];
        }

        return ['rows' => $rows, 'errors' => $errors];
    }

    public static function date(string $raw): ?string
    {
        $raw = trim($raw, " \"'");
        foreach (['d/m/Y', 'Y-m-d', 'd-m-Y'] as $format) {
            try {
                $parsed = CarbonImmutable::createFromFormat('!'.$format, $raw);
            } catch (InvalidFormatException) {
                continue;
            }
            // 31/02 "transborda" para março: a data relida precisa ser igual à digitada.
            if ($parsed instanceof CarbonImmutable && $parsed->format($format) === $raw) {
                return $parsed->toDateString();
            }
        }

        return null;
    }

    public static function number(string $raw): ?float
    {
        $clean = preg_replace('/[^\d,.\-]/', '', trim($raw, " \"'")) ?? '';
        if ($clean === '' || $clean === '-') {
            return null;
        }

        // pt-BR 1.234,56 → 1234.56 ; en 1,234.56 → 1234.56 ; 1234,5 → 1234.5
        if (str_contains($clean, ',') && (! str_contains($clean, '.') || strrpos($clean, ',') > (int) strrpos($clean, '.'))) {
            $clean = str_replace(['.', ','], ['', '.'], $clean);
        } else {
            $clean = str_replace(',', '', $clean);
        }

        return is_numeric($clean) ? (float) $clean : null;
    }

    /**
     * Separa a linha: ";" ou tab têm prioridade (planilhas em pt-BR); com vírgula, só a PRIMEIRA
     * separa (a data não tem vírgula), para "31/10/2026,1.234,56" não quebrar o número.
     *
     * @return list<string>
     */
    private static function cells(string $line): array
    {
        if (str_contains($line, ';') || str_contains($line, "\t")) {
            return array_map('trim', preg_split('/[;\t]/', $line) ?: []);
        }

        $comma = strpos($line, ',');

        return $comma === false ? [trim($line)] : [trim(substr($line, 0, $comma)), trim(substr($line, $comma + 1))];
    }
}
