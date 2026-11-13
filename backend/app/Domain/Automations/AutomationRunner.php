<?php

declare(strict_types=1);

namespace App\Domain\Automations;

use App\Domain\Reports\ReportPeriod;
use App\Domain\Reports\ReportPublisher;
use App\Models\Automation;
use App\Models\AutomationRun;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Execução de um envio automático: publica o relatório no período da automação (snapshot
 * imutável) e então envia, ou espera aprovação ("revisar antes de enviar").
 * Idempotente por (automação, horário agendado): o agendador pode tentar de novo sem duplicar.
 */
final readonly class AutomationRunner
{
    public function __construct(
        private ReportPublisher $publisher,
        private AutomationSender $sender,
        private TenantContext $context,
    ) {}

    /** Execução agendada: avança a agenda e roda. Devolve null se outro processo já rodou este horário. */
    public function runScheduled(string $automationId, CarbonImmutable $now): ?AutomationRun
    {
        $claimed = DB::transaction(function () use ($automationId, $now): ?array {
            $automation = Automation::query()->lockForUpdate()->find($automationId);
            if ($automation === null || ! $automation->active || $automation->next_run_at === null || $automation->next_run_at->gt($now)) {
                return null;
            }

            $scheduledFor = CarbonImmutable::parse($automation->next_run_at);
            $automation->forceFill(['last_run_at' => $scheduledFor])->save();
            $automation->forceFill(['next_run_at' => Schedule::next($automation, $now)])->save();

            return [$automation, $scheduledFor];
        });

        return $claimed === null ? null : $this->run($claimed[0], 'schedule', $claimed[1]);
    }

    /** "Enviar agora" (respeita a aprovação, se exigida). */
    public function runNow(Automation $automation): AutomationRun
    {
        return $this->run($automation, 'manual', CarbonImmutable::now()->startOfSecond())
            ?? throw ValidationException::withMessages(['automation' => 'Já existe um envio deste relatório neste minuto.']);
    }

    public function approve(AutomationRun $run): void
    {
        abort_if($run->status !== 'awaiting_approval', 409, 'Este envio não está aguardando aprovação.');

        $run->forceFill(['status' => 'sending', 'approved_by' => $this->context->userId(), 'approved_at' => now()])->save();
        $this->sender->send($run);
    }

    public function cancel(AutomationRun $run): void
    {
        abort_if($run->status !== 'awaiting_approval', 409, 'Só dá para cancelar envios que aguardam aprovação.');

        $run->forceFill(['status' => 'cancelled'])->save();
    }

    private function run(Automation $automation, string $trigger, CarbonImmutable $scheduledFor): ?AutomationRun
    {
        try {
            $run = AutomationRun::query()->create([
                'automation_id' => $automation->id,
                'trigger' => $trigger,
                'status' => 'sending',
                'scheduled_for' => $scheduledFor,
            ]);
        } catch (UniqueConstraintViolationException) {
            return null;
        }

        try {
            $snapshot = $this->publisher->publish($automation->report()->firstOrFail(), self::period($automation->period_preset));
        } catch (Throwable $e) {
            $run->forceFill(['status' => 'failed', 'error' => mb_substr('Não foi possível publicar o relatório: '.$e->getMessage(), 0, 300)])->save();

            return $run;
        }

        $run->forceFill(['snapshot_id' => $snapshot->id])->save();

        if ($automation->requires_approval) {
            $run->forceFill(['status' => 'awaiting_approval'])->save();

            return $run;
        }

        $this->sender->send($run);

        return $run->refresh();
    }

    /** "Este mês" no dia 1 ainda não tem dados: envia o mês passado (melhor que não enviar). */
    private static function period(string $preset): ReportPeriod
    {
        try {
            return ReportPeriod::resolve($preset);
        } catch (ValidationException) {
            return ReportPeriod::resolve('last_month');
        }
    }
}
