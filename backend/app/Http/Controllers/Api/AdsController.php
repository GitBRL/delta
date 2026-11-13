<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Ads\AdsManager;
use App\Domain\Billing\Entitlements;
use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\LiveApiException;
use App\Http\Controllers\Controller;
use App\Models\AdChange;
use App\Models\IntegrationAccount;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Gestão de Meta Ads (ADR 0030): campanhas e conjuntos das contas da agência, com pausar,
 * ativar e mudar orçamento diário. Só a equipe. "Idempotency-Key" evita aplicar duas vezes.
 */
final class AdsController extends Controller
{
    public function __construct(private readonly AdsManager $ads) {}

    public function accounts(): JsonResponse
    {
        return response()->json(['data' => IntegrationAccount::query()->where('provider', 'meta_ads')->with(['integration:id,mode,status', 'projects:id,name'])->orderBy('name')->get()
            ->map(fn (IntegrationAccount $a): array => [
                'id' => $a->id, 'name' => $a->name, 'currency' => $a->currency,
                'mode' => $a->integration?->mode, 'status' => $a->integration?->status,
                'projects' => $a->projects->map(fn ($p): array => ['id' => $p->id, 'name' => $p->name])->values()->all(),
            ])->values()->all()]);
    }

    public function campaigns(IntegrationAccount $account): JsonResponse
    {
        try {
            $campaigns = $this->ads->gateway($account)->campaigns($account);
        } catch (LiveApiException|ConnectorUnavailable $e) {
            throw ValidationException::withMessages(['account' => $e->getMessage()]);
        }

        return response()->json(['data' => $campaigns, 'meta' => [
            'currency' => $account->currency ?? 'BRL',
            'mode' => $account->integration()->value('mode'),
            'large_change_pct' => (int) (AdsManager::LARGE_CHANGE * 100),
        ]]);
    }

    public function change(Request $request, IntegrationAccount $account): JsonResponse
    {
        app(Entitlements::class)->ensureFeature('ads_management');
        $request->validate([
            'level' => ['required', Rule::in(['campaign', 'adset'])],
            'object_id' => ['required', 'string', 'max:60'],
            'action' => ['required', Rule::in(['pause', 'activate', 'budget'])],
            'daily_budget' => ['nullable', 'required_if:action,budget', 'numeric', 'min:1', 'max:10000000'],
            'confirm_large_change' => ['sometimes', 'boolean'],
            'project_id' => ['nullable', 'uuid', Rule::exists('projects', 'id')],
        ]);
        $key = $request->header('Idempotency-Key');
        if (is_string($key) && preg_match('/^[A-Za-z0-9_-]{8,80}$/', $key) !== 1) {
            throw ValidationException::withMessages(['idempotency_key' => 'Idempotency-Key deve ter de 8 a 80 caracteres (letras, números, "-" e "_").']);
        }

        /** @var 'campaign'|'adset' $level */
        $level = $request->string('level')->toString();
        /** @var 'pause'|'activate'|'budget' $action */
        $action = $request->string('action')->toString();
        $change = $this->ads->change($account, [
            'level' => $level,
            'object_id' => $request->string('object_id')->toString(),
            'action' => $action,
            'daily_budget' => $request->filled('daily_budget') ? (float) $request->string('daily_budget')->toString() : null,
            'confirm_large_change' => $request->boolean('confirm_large_change'),
        ], is_string($key) ? $key : null, $request->filled('project_id') ? $request->string('project_id')->toString() : null);

        return response()->json(['data' => self::present($change)], $change->wasRecentlyCreated ? 201 : 200);
    }

    public function changes(Request $request): JsonResponse
    {
        $query = AdChange::query()->orderByDesc('created_at')->limit(200);
        foreach (['account_id', 'project_id'] as $filter) {
            if (is_string($value = $request->query($filter)) && $value !== '') {
                $query->where($filter, $value);
            }
        }
        $changes = $query->get();
        $names = User::query()->whereIn('id', $changes->pluck('created_by')->filter()->unique()->values()->all())->pluck('name', 'id');

        return response()->json(['data' => $changes->map(fn (AdChange $c): array => [...self::present($c), 'created_by' => $c->created_by !== null ? $names->get($c->created_by) : null])->values()->all()]);
    }

    /** @return array<string, mixed> */
    private static function present(AdChange $c): array
    {
        return [
            'id' => $c->id, 'account_id' => $c->account_id, 'project_id' => $c->project_id, 'level' => $c->level,
            'object_id' => $c->object_id, 'object_name' => $c->object_name, 'action' => $c->action,
            'before' => $c->before, 'after' => $c->after, 'status' => $c->status, 'error' => $c->error,
            'created_at' => $c->created_at?->toIso8601String(),
        ];
    }
}
