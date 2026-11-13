<?php

declare(strict_types=1);

namespace App\Domain\Goals;

use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Reports\Pdf\MetricFormat;
use App\Domain\Timeline\Timeline;
use App\Domain\Webhooks\Webhooks;
use App\Mail\GoalAlertMail;
use App\Models\Goal;
use App\Models\TenantMembership;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantRole;
use Illuminate\Support\Facades\Mail;

/**
 * Avaliação diária das metas da agência do contexto. Avisa a equipe (e marca a linha do tempo)
 * só quando o estado MUDA dentro do período — nada de e-mail repetido todo dia.
 */
final readonly class GoalMonitor
{
    private const ALERT = [
        'off_track' => ['goal_off_track', 'Meta fora do ritmo'],
        'at_risk' => ['goal_at_risk', 'Meta em risco'],
        'achieved' => ['goal_achieved', 'Meta batida'],
    ];

    public function __construct(
        private GoalProgress $progress,
        private Catalog $catalog,
        private Timeline $timeline,
        private TenantContext $context,
    ) {}

    /** @return int alertas emitidos */
    public function evaluate(): int
    {
        $set = MetricSet::forCurrentTenant($this->catalog);
        $alerts = [];

        foreach (Goal::query()->with('project')->where('active', true)->get() as $goal) {
            $project = $goal->project;
            if ($project === null) {
                continue;
            }

            $result = $this->progress->compute($goal, $project, $set);
            $period = $result['period']['key'];
            $status = $result['status'];
            $changed = $goal->last_period !== $period || $goal->last_status !== $status;
            $goal->forceFill(['last_status' => $status, 'last_period' => $period])->save();

            if (! $changed || ! isset(self::ALERT[$status])) {
                continue;
            }

            [$type, $headline] = self::ALERT[$status];
            $text = self::describe($result, $goal->comparison);
            $this->timeline->record($goal->project_id, $type, "{$headline}: {$result['label']}", $text, metadata: ['goal_id' => $goal->id, 'period' => $period]);
            $alerts[] = ['project' => $project->name, 'headline' => $headline, 'text' => $text, 'status' => $status];
            Webhooks::emit('goal.status_changed', [
                'goal_id' => $goal->id, 'project_id' => $project->id, 'metric_key' => $goal->metric_key, 'status' => $status,
                'value' => $result['value'], 'target' => $result['target'], 'projection' => $result['projection'], 'period' => $result['period'],
            ]);
        }

        if ($alerts !== []) {
            $emails = $this->staffEmails();
            if ($emails !== []) {
                Mail::to($emails)->queue(new GoalAlertMail($alerts));
            }
        }

        return count($alerts);
    }

    /** @param array{period: array{label: string, closed: bool}, value: float|null, target: float, projection: float|null, cumulative: bool, unit: string, decimals: int} $r */
    public static function describe(array $r, string $comparison): string
    {
        $fmt = fn (mixed $v): string => MetricFormat::value($v, $r['unit'], $r['decimals']);
        $goal = ($comparison === 'at_least' ? 'meta de pelo menos ' : 'meta de no máximo ').$fmt($r['target']);
        $period = $r['period']['label'];

        return $r['cumulative'] && ! $r['period']['closed']
            ? "{$period}: {$fmt($r['value'])} até agora, projeção de {$fmt($r['projection'])} ({$goal})."
            : "{$period}: {$fmt($r['value'])} ({$goal}).";
    }

    /** @return list<string> */
    private function staffEmails(): array
    {
        $ids = TenantMembership::query()->where('tenant_id', $this->context->tenantId())
            ->where('role', '!=', TenantRole::Client->value)->pluck('user_id')->all();

        return array_values(array_filter(User::query()->whereIn('id', $ids)->pluck('email')->all(), 'is_string'));
    }
}
