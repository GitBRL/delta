<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Automations\AutomationRunner;
use App\Domain\Automations\MessageComposer;
use App\Domain\Automations\Schedule;
use App\Domain\Billing\Entitlements;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Reports\ReportLayout;
use App\Domain\Reports\ReportPeriod;
use App\Domain\Reports\ReportRenderer;
use App\Domain\Reports\SharedReports;
use App\Http\Controllers\Controller;
use App\Models\Automation;
use App\Models\AutomationRun;
use App\Models\Contact;
use App\Models\Report;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Envios automáticos de relatório (tela "Envio automático"). Equipe da agência. */
final class AutomationController extends Controller
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly Audit $audit,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Automation::query()->with(['project:id,name', 'report:id,title', 'recipients'])->orderBy('name');
        if (is_string($projectId = $request->query('project_id')) && $projectId !== '') {
            $query->where('project_id', $projectId);
        }

        return response()->json(['data' => $query->get()->map(self::present(...))->values()->all()]);
    }

    public function show(Automation $automation): JsonResponse
    {
        return response()->json(['data' => self::present($automation->load(['project:id,name', 'report:id,title', 'recipients']))]);
    }

    public function store(Request $request): JsonResponse
    {
        app(Entitlements::class)->ensure('automations');
        $automation = DB::transaction(fn (): Automation => $this->save(new Automation(['created_by' => $this->context->userId()]), $request));
        $this->audit->record('automation.created', $automation);

        return response()->json(['data' => self::present($automation->load(['project:id,name', 'report:id,title', 'recipients']))], 201);
    }

    public function update(Request $request, Automation $automation): JsonResponse
    {
        $automation = DB::transaction(fn (): Automation => $this->save($automation, $request));
        $this->audit->record('automation.updated', $automation);

        return response()->json(['data' => self::present($automation->load(['project:id,name', 'report:id,title', 'recipients']))]);
    }

    public function destroy(Automation $automation): Response
    {
        $this->audit->record('automation.deleted', $automation, ['name' => $automation->name]);
        $automation->delete();

        return response()->noContent();
    }

    /** "Enviar agora": publica e envia (ou deixa aguardando aprovação). */
    public function runNow(Automation $automation, AutomationRunner $runner): JsonResponse
    {
        $run = $runner->runNow($automation);
        $this->audit->record('automation.run_now', $run, ['automation_id' => $automation->id]);

        return response()->json(['data' => AutomationRunController::present($run->refresh())], 201);
    }

    /** Prévia da mensagem com os números atuais do relatório (igual ao que o contato vai receber). */
    public function preview(Request $request, ReportRenderer $renderer, Catalog $catalog): JsonResponse
    {
        $request->validate([
            'report_id' => ['required', 'uuid'],
            'period_preset' => ['required', Rule::in(['last_7', 'last_14', 'last_30', 'last_month', 'this_month'])],
            'message' => ['required', 'string', 'max:2000'],
            'contact_id' => ['nullable', 'uuid'],
        ]);

        $report = Report::query()->find($request->string('report_id')->toString()) ?? throw ValidationException::withMessages(['report_id' => 'Relatório não encontrado.']);
        $contact = $request->filled('contact_id') ? Contact::query()->find($request->string('contact_id')->toString()) : null;
        $set = MetricSet::forCurrentTenant($catalog);
        $period = ReportPeriod::resolve($request->string('period_preset')->toString());
        $rendered = $renderer->render($report->project()->firstOrFail(), $report->title, ReportLayout::normalize($report->layout, $set), $period, $report->compare, $set);
        $link = substr(SharedReports::url(str_repeat('x', 40)), 0, -40).'…';

        return response()->json(['data' => [
            'subject' => MessageComposer::subject($rendered),
            'text' => MessageComposer::render($request->string('message')->toString(), $contact, $rendered, $link),
            'whatsapp_params' => MessageComposer::templateParams($contact, $rendered, $link),
        ]]);
    }

    private function save(Automation $automation, Request $request): Automation
    {
        $creating = ! $automation->exists;
        $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'report_id' => [$creating ? 'required' : 'prohibited', 'uuid'],
            'channels' => ['required', 'array', 'min:1'],
            'channels.*' => [Rule::in(['email', 'whatsapp'])],
            'frequency' => ['required', Rule::in(['daily', 'weekly', 'biweekly', 'monthly'])],
            'weekday' => ['nullable', 'required_if:frequency,weekly,biweekly', 'integer', 'between:1,7'],
            'month_day' => ['nullable', 'required_if:frequency,monthly', 'integer', 'between:1,28'],
            'send_time' => ['required', 'date_format:H:i'],
            'period_preset' => ['required', Rule::in(['last_7', 'last_14', 'last_30', 'last_month', 'this_month'])],
            'message' => ['required', 'string', 'min:2', 'max:2000'],
            'attach_pdf' => ['boolean'],
            'requires_approval' => ['boolean'],
            'active' => ['boolean'],
            'recipient_ids' => ['required', 'array', 'min:1', 'max:50'],
            'recipient_ids.*' => ['uuid'],
        ], [
            'recipient_ids.required' => 'Escolha ao menos um contato.',
            'recipient_ids.min' => 'Escolha ao menos um contato.',
            'channels.required' => 'Escolha ao menos um canal.',
            'weekday.required_if' => 'Escolha o dia da semana.',
            'month_day.required_if' => 'Escolha o dia do mês (1 a 28).',
        ]);

        if ($creating) {
            $report = Report::query()->find($request->string('report_id')->toString()) ?? throw ValidationException::withMessages(['report_id' => 'Relatório não encontrado.']);
            $automation->fill(['report_id' => $report->id, 'project_id' => $report->project_id]);
        }

        $recipientIds = self::strings($request->input('recipient_ids'));
        $valid = Contact::query()->where('project_id', $automation->project_id)->whereIn('id', $recipientIds)->pluck('id')->all();
        if (count($valid) !== count($recipientIds)) {
            throw ValidationException::withMessages(['recipient_ids' => 'Os destinatários precisam ser contatos deste projeto.']);
        }

        $frequency = $request->string('frequency')->toString();
        $automation->fill([
            'name' => $request->string('name')->toString(),
            'channels' => self::strings($request->input('channels')),
            'frequency' => $frequency,
            'weekday' => in_array($frequency, ['weekly', 'biweekly'], true) ? $request->integer('weekday') : null,
            'month_day' => $frequency === 'monthly' ? $request->integer('month_day') : null,
            'send_time' => $request->string('send_time')->toString(),
            'period_preset' => $request->string('period_preset')->toString(),
            'message' => $request->string('message')->toString(),
            'attach_pdf' => $request->boolean('attach_pdf', true),
            'requires_approval' => $request->boolean('requires_approval'),
            'active' => $request->boolean('active', true),
        ]);
        $automation->next_run_at = $automation->active ? Schedule::next($automation, CarbonImmutable::now()) : null;
        $automation->save();
        $automation->recipients()->sync($recipientIds);

        return $automation;
    }

    /** @return list<string> */
    private static function strings(mixed $value): array
    {
        return is_array($value) ? array_values(array_unique(array_filter($value, 'is_string'))) : [];
    }

    /** @return array<string, mixed> */
    public static function present(Automation $a): array
    {
        $last = AutomationRun::query()->where('automation_id', $a->id)->orderByDesc('created_at')->first();

        return [
            'id' => $a->id,
            'name' => $a->name,
            'project' => $a->project === null ? null : ['id' => $a->project->id, 'name' => $a->project->name],
            'report' => $a->report === null ? null : ['id' => $a->report->id, 'title' => $a->report->title],
            'channels' => $a->channels,
            'frequency' => $a->frequency,
            'weekday' => $a->weekday,
            'month_day' => $a->month_day,
            'send_time' => substr($a->send_time, 0, 5),
            'schedule_label' => Schedule::describe($a),
            'period_preset' => $a->period_preset,
            'message' => $a->message,
            'attach_pdf' => $a->attach_pdf,
            'requires_approval' => $a->requires_approval,
            'active' => $a->active,
            'next_run_at' => $a->next_run_at?->toIso8601String(),
            'last_run_at' => $a->last_run_at?->toIso8601String(),
            'recipients' => $a->recipients->map(ContactController::present(...))->values()->all(),
            'last_run' => $last === null ? null : ['id' => $last->id, 'status' => $last->status, 'created_at' => $last->created_at?->toIso8601String()],
        ];
    }
}
