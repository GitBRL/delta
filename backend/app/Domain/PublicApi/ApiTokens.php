<?php

declare(strict_types=1);

namespace App\Domain\PublicApi;

use App\Models\ApiToken;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Tokens da API pública: "dlt_" + 40 caracteres; o banco guarda o sha256. ADR 0020. */
final readonly class ApiTokens
{
    public const SCOPES = [
        'projects:read' => 'Ler projetos e contas vinculadas',
        'metrics:read' => 'Consultar métricas e indicadores',
        'reports:read' => 'Ler relatórios, versões publicadas e PDFs',
        'reports:write' => 'Publicar relatórios',
        'webhooks:manage' => 'Gerenciar webhooks',
        'connect' => 'Delta Connect: criar customers e consultar dados por customer token',
        'mcp:tools' => 'Usar o Delta em assistentes de IA (MCP), com as leituras liberadas acima',
    ];

    public function __construct(private TenantContext $context) {}

    /**
     * @param  list<string>  $scopes
     * @return array{0: ApiToken, 1: string}
     */
    public function create(string $name, array $scopes, ?int $expiresInDays): array
    {
        $plain = 'dlt_'.Str::random(40);
        $token = ApiToken::query()->create([
            'name' => $name,
            'token_prefix' => substr($plain, 0, 10),
            'token_hash' => hash('sha256', $plain),
            'scopes' => array_values(array_unique($scopes)),
            'expires_at' => $expiresInDays === null ? null : now()->addDays($expiresInDays),
            'created_by' => $this->context->userId(),
        ]);

        return [$token, $plain];
    }

    /** @return object{token_id: string, tenant_id: string, scopes: string, expires_at: string|null, revoked_at: string|null}|null */
    public static function lookup(string $plain): ?object
    {
        if (preg_match('/^dlt_[A-Za-z0-9]{40}$/', $plain) !== 1) {
            return null;
        }

        /** @var object{token_id: string, tenant_id: string, scopes: string, expires_at: string|null, revoked_at: string|null}|null $row */
        $row = DB::selectOne('select * from app.api_token_lookup(?)', [hash('sha256', $plain)]);

        return $row;
    }
}
