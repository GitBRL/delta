<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Str;
use InvalidArgumentException;
use PDO;

/**
 * Fonte única do contexto de segurança (tenant + usuário) da operação atual.
 *
 * Espelha o estado nas variáveis de sessão do Postgres (app.tenant_id / app.user_id),
 * que as políticas de RLS leem. No Delta Connect há ainda o projeto do customer
 * (app.customer_project_id): tudo o que tem project_id fica restrito a ele (ADR 0032). Regras:
 *  - todo request começa e termina com clear() (middleware ResetDatabaseContext);
 *  - todo job roda dentro de run() (middleware de job TenantAware) e o worker limpa antes/depois;
 *  - se a conexão cair e o Laravel reconectar, reapply() restaura o contexto na nova sessão.
 */
final class TenantContext
{
    private ?string $tenantId = null;

    private ?string $userId = null;

    private ?string $customerProjectId = null;

    public function __construct(private readonly DatabaseManager $db) {}

    public function tenantId(): ?string
    {
        return $this->tenantId;
    }

    public function userId(): ?string
    {
        return $this->userId;
    }

    public function customerProjectId(): ?string
    {
        return $this->customerProjectId;
    }

    /** Delta Connect: restringe a operação ao projeto do customer (política RESTRICTIVE). */
    public function setCustomerProject(?string $projectId): void
    {
        $this->customerProjectId = self::uuidOrNull($projectId, 'projeto');
        $this->sync($this->connection());
    }

    public function hasTenant(): bool
    {
        return $this->tenantId !== null;
    }

    public function setUser(?string $userId): void
    {
        $this->set($this->tenantId, $userId);
    }

    public function setTenant(?string $tenantId): void
    {
        $this->set($tenantId, $this->userId);
    }

    public function set(?string $tenantId, ?string $userId): void
    {
        $tenantId = self::uuidOrNull($tenantId, 'tenant');
        if ($tenantId !== $this->tenantId) {
            $this->customerProjectId = null; // projeto de customer só vale na própria agência
        }
        $this->tenantId = $tenantId;
        $this->userId = self::uuidOrNull($userId, 'user');
        Context::add(['tenant_id' => $this->tenantId, 'user_id' => $this->userId]); // correlação nos logs

        $this->sync($this->connection());
    }

    /** Limpa o contexto. Não abre conexão só para isso: se não há conexão, não há sessão a limpar. */
    public function clear(): void
    {
        $this->tenantId = null;
        $this->userId = null;
        $this->customerProjectId = null;
        Context::forget(['tenant_id', 'user_id']);

        $connection = $this->connection();
        if ($connection->getRawPdo() instanceof PDO) {
            $this->sync($connection);
        }
    }

    /**
     * Executa $callback com o contexto informado e restaura o anterior ao final, mesmo com exceção.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function run(?string $tenantId, ?string $userId, Closure $callback): mixed
    {
        $previous = [$this->tenantId, $this->userId];
        $this->set($tenantId, $userId);

        try {
            return $callback();
        } finally {
            $this->set(...$previous);
        }
    }

    /** Reaplica o contexto em uma conexão recém-estabelecida (listener de ConnectionEstablished). */
    public function reapply(Connection $connection): void
    {
        if ($connection->getName() !== $this->db->getDefaultConnection()) {
            return;
        }

        if ($this->tenantId !== null || $this->userId !== null || $this->customerProjectId !== null) {
            $this->sync($connection);
        }
    }

    private function sync(Connection $connection): void
    {
        $connection->select(
            "select set_config('app.tenant_id', ?, false), set_config('app.user_id', ?, false), set_config('app.customer_project_id', ?, false)",
            [$this->tenantId ?? '', $this->userId ?? '', $this->customerProjectId ?? ''],
        );
    }

    private function connection(): Connection
    {
        return $this->db->connection();
    }

    private static function uuidOrNull(?string $value, string $label): ?string
    {
        if ($value === null) {
            return null;
        }

        if (! Str::isUuid($value)) {
            throw new InvalidArgumentException("Identificador de {$label} inválido no contexto de segurança.");
        }

        return strtolower($value);
    }
}
