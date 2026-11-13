<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Automations\AutomationRunner;
use App\Http\Controllers\Controller;
use App\Models\Automation;
use App\Models\AutomationRun;
use App\Models\Message;
use App\Models\User;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Histórico de envios, aprovação ("revisar antes de enviar") e status por mensagem. */
final class AutomationRunController extends Controller
{
    public function __construct(
        private readonly AutomationRunner $runner,
        private readonly Audit $audit,
    ) {}

    /** ?status=awaiting_approval lista as aprovações pendentes da agência inteira. */
    public function index(Request $request): JsonResponse
    {
        $query = AutomationRun::query()->with('automation:id,name,project_id')->orderByDesc('created_at')->limit(100);
        if (is_string($status = $request->query('status')) && $status !== '') {
            $query->where('status', $status);
        }
        if (is_string($automationId = $request->query('automation_id')) && $automationId !== '') {
            $query->where('automation_id', $automationId);
        }

        return response()->json(['data' => $query->get()->map(self::present(...))->values()->all()]);
    }

    public function show(AutomationRun $run): JsonResponse
    {
        $messages = Message::query()->with('contact:id,name')->where('run_id', $run->id)->orderBy('channel')->get();

        return response()->json(['data' => [...self::present($run->load('automation:id,name,project_id')), 'messages' => $messages->map(fn (Message $m): array => [
            'id' => $m->id,
            'channel' => $m->channel,
            'recipient' => $m->recipient,
            'contact_name' => $m->contact?->name,
            'provider' => $m->provider,
            'status' => $m->status,
            'error' => $m->error,
            'body' => $m->body,
            'sent_at' => $m->sent_at?->toIso8601String(),
            'delivered_at' => $m->delivered_at?->toIso8601String(),
            'read_at' => $m->read_at?->toIso8601String(),
        ])->values()->all()]]);
    }

    public function approve(AutomationRun $run): JsonResponse
    {
        $this->runner->approve($run);
        $this->audit->record('automation.approved', $run);

        return response()->json(['data' => self::present($run->refresh())]);
    }

    public function cancel(AutomationRun $run): JsonResponse
    {
        $this->runner->cancel($run);
        $this->audit->record('automation.cancelled', $run);

        return response()->json(['data' => self::present($run->refresh())]);
    }

    /** @return array<string, mixed> */
    public static function present(AutomationRun $run): array
    {
        $counts = Message::query()->where('run_id', $run->id)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $automation = $run->relationLoaded('automation') ? $run->automation : Automation::query()->find($run->automation_id);

        return [
            'id' => $run->id,
            'automation_id' => $run->automation_id,
            'automation_name' => $automation?->name,
            'project_id' => $automation?->project_id,
            'trigger' => $run->trigger,
            'status' => $run->status,
            'scheduled_for' => $run->scheduled_for->toIso8601String(),
            'snapshot_id' => $run->snapshot_id,
            'approved_by' => $run->approved_by !== null ? User::query()->whereKey($run->approved_by)->value('name') : null,
            'approved_at' => $run->approved_at?->toIso8601String(),
            'error' => $run->error,
            'counts' => array_map(fn ($n): int => is_numeric($n) ? (int) $n : 0, array_merge(
                ['queued' => 0, 'sent' => 0, 'delivered' => 0, 'read' => 0, 'failed' => 0, 'skipped' => 0],
                $counts->all(),
            )),
            'created_at' => $run->created_at?->toIso8601String(),
        ];
    }
}
