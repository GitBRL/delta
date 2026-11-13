<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Branding\Brand;
use App\Domain\Metrics\Catalog\Catalog;
use App\Domain\Metrics\Catalog\MetricSet;
use App\Domain\Reports\ReportLayout;
use App\Domain\Reports\ReportRenderer;
use App\Domain\Reports\SharedReports;
use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Relatório aberto por link público (sem login). Nada é lido no contexto da agência:
 * app.shared_report busca pelo hash do token (ADR 0011). Link com senha: os dados só saem
 * no "unlock"; o PDF sai por URL assinada de 10 minutos, entregue junto com os dados.
 */
final class PublicReportController extends Controller
{
    public const LIVE_TTL = 300;

    public function __construct(
        private readonly SharedReports $shared,
        private readonly TenantContext $context,
        private readonly ReportRenderer $renderer,
        private readonly Catalog $catalog,
    ) {}

    public function show(string $token): JsonResponse
    {
        $row = $this->available($token);

        if ($row->password_hash !== null) {
            return response()->json(['requires_password' => true, 'title' => $row->title, 'agency' => $row->tenant_name], 401);
        }

        return $this->payload($token, $row);
    }

    public function unlock(Request $request, string $token): JsonResponse
    {
        $row = $this->available($token);
        $request->validate(['password' => ['required', 'string', 'max:100']], ['password.required' => 'Informe a senha do relatório.']);
        $password = $request->input('password');

        if ($row->password_hash === null || ! is_string($password) || ! Hash::check($password, $row->password_hash)) {
            return response()->json(['message' => 'Senha incorreta.', 'errors' => ['password' => ['Senha incorreta.']]], 422);
        }

        return $this->payload($token, $row);
    }

    public function pdf(string $token): StreamedResponse|JsonResponse
    {
        $row = $this->available($token);

        abort_if($row->report_id !== null, 404, 'Dashboards ao vivo não têm PDF: publique uma versão do relatório.');

        if ($row->pdf_status !== 'ready' || $row->pdf_path === null || ! Storage::disk('local')->exists($row->pdf_path)) {
            return response()->json(['status' => $row->pdf_status, 'message' => 'O PDF ainda está sendo gerado. Tente de novo em alguns segundos.'], 202);
        }

        return Storage::disk('local')->download($row->pdf_path, Str::slug($row->title).'.pdf', ['Content-Type' => 'application/pdf']);
    }

    /** @return object{link_id: string, snapshot_id: string|null, report_id: string|null, tenant_id: string, tenant_name: string, title: string, data: string|null, pdf_status: string|null, pdf_path: string|null, password_hash: string|null, expires_at: string|null, revoked_at: string|null, created_at: string} */
    private function available(string $token): object
    {
        $row = $this->shared->find($token) ?? abort(404, 'Relatório não encontrado. Confira o link.');
        $reason = SharedReports::unavailable($row);
        abort_if($reason !== null, 410, (string) $reason);

        return $row;
    }

    /** @param object{link_id: string, snapshot_id: string|null, report_id: string|null, tenant_id: string, tenant_name: string, title: string, data: string|null, pdf_status: string|null, pdf_path: string|null, password_hash: string|null, expires_at: string|null, revoked_at: string|null, created_at: string} $row */
    private function payload(string $token, object $row): JsonResponse
    {
        $this->shared->countView($token);
        $live = $row->report_id !== null;
        $data = $live ? $this->live($row->tenant_id, $row->link_id, $row->report_id) : json_decode((string) $row->data, true);

        return response()->json(['data' => [
            'title' => $row->title,
            'agency' => $row->tenant_name,
            'live' => $live,
            'published_at' => CarbonImmutable::parse($row->created_at)->toIso8601String(),
            'refreshed_at' => $live && is_array($data) ? ($data['generated_at'] ?? null) : null,
            'report' => is_array($data) ? $data : null,
            'branding' => $this->context->run($row->tenant_id, null, fn (): array => Brand::current($row->tenant_id)->toPublic()),
            'pdf_status' => $live ? null : $row->pdf_status,
            'pdf_url' => $live ? null : URL::temporarySignedRoute('public-reports.pdf', now()->addMinutes(10), ['token' => $token], absolute: false),
        ]]);
    }

    /**
     * Dashboard ao vivo: recalcula no contexto da agência dona do link (o hash do token já provou
     * o acesso), sem usuário — e só leitura. Cache de 5 minutos por link para TVs e muitos acessos.
     *
     * @return array<string, mixed>
     */
    private function live(string $tenantId, string $linkId, string $reportId): array
    {
        /** @var array<string, mixed> */
        return Cache::remember("live-report:{$linkId}", self::LIVE_TTL, fn (): array => $this->context->run($tenantId, null, function () use ($reportId): array {
            $report = Report::query()->findOrFail($reportId);
            $set = MetricSet::forCurrentTenant($this->catalog);

            return $this->renderer->render($report->project()->firstOrFail(), $report->title, ReportLayout::normalize($report->layout, $set), $report->period(), $report->compare, $set);
        }));
    }
}
