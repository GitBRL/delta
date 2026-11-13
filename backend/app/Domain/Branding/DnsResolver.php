<?php

declare(strict_types=1);

namespace App\Domain\Branding;

/** Consulta de CNAME (separada para os testes poderem substituir). */
class DnsResolver
{
    /** @return list<string> destinos do CNAME, em minúsculas e sem o ponto final */
    public function cnames(string $host): array
    {
        $records = @dns_get_record($host, DNS_CNAME);
        if ($records === false) {
            return [];
        }

        return array_values(array_filter(array_map(
            fn (array $r): ?string => is_string($r['target'] ?? null) ? rtrim(strtolower($r['target']), '.') : null,
            $records,
        )));
    }
}
