<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Reports\SharedReports;
use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Models\ReportSnapshot;
use App\Models\ShareLink;
use App\Support\Audit\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Links públicos de um relatório publicado (equipe da agência). O link só aparece na criação. */
final class ShareLinkController extends Controller
{
    public function __construct(
        private readonly SharedReports $shared,
        private readonly Audit $audit,
    ) {}

    public function index(ReportSnapshot $snapshot): JsonResponse
    {
        return response()->json(['data' => ShareLink::query()->where('snapshot_id', $snapshot->id)->orderByDesc('created_at')->get()
            ->map(self::present(...))->values()->all()]);
    }

    /** Links ao vivo (dashboard) de um relatório. */
    public function indexLive(Report $report): JsonResponse
    {
        return response()->json(['data' => ShareLink::query()->where('report_id', $report->id)->orderByDesc('created_at')->get()
            ->map(self::present(...))->values()->all()]);
    }

    public function storeLive(Request $request, Report $report): JsonResponse
    {
        return $this->create($request, $report);
    }

    public function store(Request $request, ReportSnapshot $snapshot): JsonResponse
    {
        return $this->create($request, $snapshot);
    }

    private function create(Request $request, ReportSnapshot|Report $target): JsonResponse
    {
        /** @var array{expires_in_days?: int|null, password?: string|null} $data */
        $data = $request->validate([
            'expires_in_days' => ['nullable', 'integer', 'min:1', 'max:365'],
            'password' => ['nullable', 'string', 'min:4', 'max:100'],
        ], [
            'expires_in_days.max' => 'O link pode valer no máximo 365 dias.',
            'password.min' => 'A senha do link precisa de pelo menos 4 caracteres.',
        ]);

        [$link, $token] = $this->shared->create($target, $data['expires_in_days'] ?? null, $data['password'] ?? null);
        $this->audit->record('share_link.created', $link, [
            'live' => $target instanceof Report, 'protected' => $link->password_hash !== null, 'expires_at' => $link->expires_at?->toIso8601String(),
        ]);

        return response()->json(['data' => self::present($link), 'url' => SharedReports::url($token)], 201);
    }

    public function destroy(ShareLink $shareLink): Response
    {
        if ($shareLink->revoked_at === null) {
            $shareLink->forceFill(['revoked_at' => now()])->save();
            $this->audit->record('share_link.revoked', $shareLink);
        }

        return response()->noContent();
    }

    /** @return array<string, mixed> */
    private static function present(ShareLink $link): array
    {
        return [
            'id' => $link->id,
            'snapshot_id' => $link->snapshot_id,
            'report_id' => $link->report_id,
            'live' => $link->report_id !== null,
            'protected' => $link->password_hash !== null,
            'expires_at' => $link->expires_at?->toIso8601String(),
            'revoked_at' => $link->revoked_at?->toIso8601String(),
            'active' => $link->isActive(),
            'view_count' => $link->view_count,
            'last_viewed_at' => $link->last_viewed_at?->toIso8601String(),
            'created_at' => $link->created_at?->toIso8601String(),
        ];
    }
}
