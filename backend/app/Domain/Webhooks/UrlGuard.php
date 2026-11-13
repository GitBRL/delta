<?php

declare(strict_types=1);

namespace App\Domain\Webhooks;

use Illuminate\Validation\ValidationException;

/**
 * Proteção contra SSRF: webhooks só para HTTPS público. O host é resolvido e nenhum dos IPs pode
 * ser privado, reservado, de loopback ou link-local (checado no cadastro E a cada entrega, por
 * causa de DNS rebinding). Em ambiente local, http e localhost são aceitos para testes.
 */
class UrlGuard
{
    public function __construct(private readonly ?bool $allowLocal = null) {}

    public function check(string $url): void
    {
        $parts = parse_url($url);
        $scheme = is_array($parts) ? ($parts['scheme'] ?? '') : '';
        $host = is_array($parts) ? strtolower($parts['host'] ?? '') : '';
        $local = $this->allowLocal ?? app()->environment('local', 'testing');

        if ($host === '' || ! in_array($scheme, $local ? ['https', 'http'] : ['https'], true) || isset($parts['user']) || isset($parts['pass'])) {
            throw ValidationException::withMessages(['url' => 'Use uma URL https pública, sem usuário e senha.']);
        }

        if ($local) {
            return;
        }

        $ips = filter_var($host, FILTER_VALIDATE_IP) !== false ? [$host] : $this->resolve($host);
        if ($ips === []) {
            throw ValidationException::withMessages(['url' => 'Não foi possível resolver o endereço do webhook.']);
        }

        foreach ($ips as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                throw ValidationException::withMessages(['url' => 'O webhook não pode apontar para endereços internos.']);
            }
        }
    }

    /** @return list<string> */
    protected function resolve(string $host): array
    {
        $ips = gethostbynamel($host);
        $v6 = @dns_get_record($host, DNS_AAAA);

        return [...($ips === false ? [] : $ips), ...array_values(array_filter(array_map(fn (array $r): mixed => $r['ipv6'] ?? null, $v6 === false ? [] : $v6), 'is_string'))];
    }
}
