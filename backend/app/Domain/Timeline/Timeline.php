<?php

declare(strict_types=1);

namespace App\Domain\Timeline;

use App\Models\TimelineEvent;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonInterface;
use Throwable;

/** Grava marcos da linha do tempo. Falhar aqui nunca derruba a operação principal. */
final readonly class Timeline
{
    public function __construct(private TenantContext $context) {}

    /** @param array<string, mixed> $metadata */
    public function record(string $projectId, string $type, string $title, ?string $description = null, ?CarbonInterface $on = null, array $metadata = []): void
    {
        try {
            TimelineEvent::query()->create([
                'project_id' => $projectId,
                'type' => $type,
                'title' => mb_substr($title, 0, 160),
                'description' => $description === null ? null : mb_substr($description, 0, 1000),
                'occurred_on' => ($on ?? now())->toDateString(),
                'metadata' => $metadata,
                'created_by' => $this->context->userId(),
            ]);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
