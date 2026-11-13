<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Models\AuditLog;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/** Registra eventos relevantes de segurança e negócio em audit_logs (append-only). */
final readonly class Audit
{
    public function __construct(
        private TenantContext $context,
        private Request $request,
    ) {}

    /** @param array<string, mixed> $metadata */
    public function record(string $action, ?Model $subject = null, array $metadata = []): void
    {
        AuditLog::query()->create([
            'tenant_id' => $this->context->tenantId(),
            'actor_user_id' => $this->context->userId(),
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'ip' => $this->request->ip(),
            'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 500),
            'metadata' => $metadata,
        ]);
    }
}
