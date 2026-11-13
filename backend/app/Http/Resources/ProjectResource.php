<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Insights\ProjectGoals;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Project
 *
 * @property Project $resource
 */
final class ProjectResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $goals = ProjectGoals::of($this->resource);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'niche' => $this->niche,
            'goals' => [
                'gross_margin_pct' => $goals->grossMarginPct,
                'target_cpa' => $goals->targetCpa,
                'target_roas' => $goals->targetRoas,
            ],
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
