<?php

declare(strict_types=1);

namespace App\Domain\Contacts;

/** Telefone em E.164 (+5511999998888). Sem código de país, assume Brasil (+55). */
final class Phone
{
    public static function normalize(?string $raw): ?string
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }

        $international = str_starts_with(trim($raw), '+');
        $digits = (string) preg_replace('/\D+/', '', $raw);

        if (! $international && (strlen($digits) === 10 || strlen($digits) === 11)) {
            $digits = '55'.$digits; // DDD + número
        }

        return strlen($digits) >= 10 && strlen($digits) <= 15 ? '+'.$digits : null;
    }

    /** "+55 (11) 99999-8888" para exibir. */
    public static function display(string $e164): string
    {
        if (preg_match('/^\+55(\d{2})(\d{4,5})(\d{4})$/', $e164, $m) === 1) {
            return "+55 ({$m[1]}) {$m[2]}-{$m[3]}";
        }

        return $e164;
    }
}
