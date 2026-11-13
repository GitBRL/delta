<?php

declare(strict_types=1);

namespace App\Domain\Ads;

use App\Domain\Integrations\ConnectorUnavailable;
use App\Domain\Integrations\Live\LiveApiException;
use App\Domain\Timeline\Timeline;
use App\Domain\Webhooks\Webhooks;
use App\Models\AdChange;
use App\Models\IntegrationAccount;
use App\Models\ProjectAccount;
use App\Support\Audit\Audit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Validation\ValidationException;
use NumberFormatter;

/**
 * Gestão de Meta Ads (ADR 0030): pausar, ativar e mudar o orçamento diário de campanhas e
 * conjuntos, com registro de cada mudança, marco na linha do tempo e trava contra saltos de
 * orçamento acima de 50% (reiniciam o aprendizado da Meta) sem confirmação explícita.
 */
final readonly class AdsManager
{
    public const LARGE_CHANGE = 0.5;

    public function __construct(
        private TenantContext $context,
        private Audit $audit,
        private Timeline $timeline,
    ) {}

    public function gateway(IntegrationAccount $account): AdsGateway
    {
        if ($account->provider !== 'meta_ads') {
            throw ValidationException::withMessages(['account' => 'A gestão de anúncios está disponível para contas do Meta Ads.']);
        }

        return $account->integration()->firstOrFail()->isSandbox() ? app(SandboxAdsGateway::class) : app(MetaAdsGateway::class);
    }

    /**
     * @param  array{level: 'campaign'|'adset', object_id: string, action: 'pause'|'activate'|'budget', daily_budget?: float|null, confirm_large_change?: bool}  $input
     */
    public function change(IntegrationAccount $account, array $input, ?string $idempotencyKey, ?string $projectId): AdChange
    {
        if ($idempotencyKey !== null) {
            $previous = AdChange::query()->where('idempotency_key', $idempotencyKey)->first();
            if ($previous !== null) {
                return $previous; // repetição do mesmo pedido: não aplica de novo
            }
        }

        $gateway = $this->gateway($account);
        $object = $this->find($gateway->campaigns($account), $input['level'], $input['object_id']);
        $kind = $input['level'] === 'campaign' ? 'Campanha' : 'Conjunto';

        [$before, $after, $apply, $title] = match ($input['action']) {
            'pause', 'activate' => $this->statusChange($object, $input['action'], $kind),
            'budget' => $this->budgetChange($account, $object, $input, $kind),
        };

        try {
            $apply($gateway, $account);
            $status = 'applied';
            $error = null;
        } catch (LiveApiException|ConnectorUnavailable $e) {
            $status = 'failed';
            $error = mb_substr($e->getMessage(), 0, 500);
        }

        $change = AdChange::query()->create([
            'account_id' => $account->id,
            'project_id' => $projectId,
            'level' => $input['level'],
            'object_id' => $object['id'],
            'object_name' => mb_substr($object['name'], 0, 255),
            'action' => $input['action'],
            'before' => $before,
            'after' => $after,
            'status' => $status,
            'error' => $error,
            'idempotency_key' => $idempotencyKey,
            'created_by' => $this->context->userId(),
        ]);

        if ($status === 'failed') {
            throw ValidationException::withMessages(['change' => 'A Meta não aplicou a mudança: '.$error]);
        }

        $this->audit->record('ads.changed', $change, ['action' => $change->action, 'object' => $change->object_id]);
        Webhooks::emit('ads.changed', ['account_id' => $account->id, 'level' => $change->level, 'object_id' => $change->object_id, 'action' => $change->action, 'before' => $before, 'after' => $after]);
        $projects = $projectId !== null ? [$projectId] : ProjectAccount::query()->where('integration_account_id', $account->id)->pluck('project_id')->all();
        foreach (array_unique(array_filter($projects, 'is_string')) as $project) {
            $this->timeline->record($project, 'ads_change', $title, null, metadata: ['change_id' => $change->id, 'account' => $account->name]);
        }

        return $change;
    }

    /**
     * @param  list<array<string, mixed>>  $campaigns
     * @return array{id: string, name: string, status: string, daily_budget: float|null, lifetime_budget: float|null, campaign_budget?: bool, adset_budgets?: bool}
     */
    private function find(array $campaigns, string $level, string $id): array
    {
        foreach ($campaigns as $c) {
            $adsets = is_array($c['adsets'] ?? null) ? $c['adsets'] : [];
            if ($level === 'campaign' && ($c['id'] ?? null) === $id) {
                return [
                    'id' => $id, 'name' => self::str($c['name'] ?? ''), 'status' => self::str($c['status'] ?? ''),
                    'daily_budget' => self::float($c['daily_budget'] ?? null), 'lifetime_budget' => self::float($c['lifetime_budget'] ?? null),
                    'adset_budgets' => array_filter($adsets, fn (mixed $a): bool => is_array($a) && ($a['daily_budget'] ?? null) !== null) !== [],
                ];
            }
            foreach ($adsets as $a) {
                if ($level === 'adset' && is_array($a) && ($a['id'] ?? null) === $id) {
                    return [
                        'id' => $id, 'name' => self::str($a['name'] ?? ''), 'status' => self::str($a['status'] ?? ''),
                        'daily_budget' => self::float($a['daily_budget'] ?? null), 'lifetime_budget' => self::float($a['lifetime_budget'] ?? null),
                        'campaign_budget' => ($c['daily_budget'] ?? null) !== null || ($c['lifetime_budget'] ?? null) !== null,
                    ];
                }
            }
        }

        throw ValidationException::withMessages(['object_id' => 'Campanha ou conjunto não encontrado nesta conta.']);
    }

    /**
     * @param  array{id: string, name: string, status: string}  $object
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: \Closure(AdsGateway, IntegrationAccount): void, 3: string}
     */
    private function statusChange(array $object, string $action, string $kind): array
    {
        $target = $action === 'pause' ? 'PAUSED' : 'ACTIVE';
        if ($object['status'] === $target) {
            throw ValidationException::withMessages(['action' => $action === 'pause' ? "{$kind} já está pausado(a)." : "{$kind} já está ativo(a)."]);
        }

        return [
            ['status' => $object['status']],
            ['status' => $target],
            fn (AdsGateway $g, IntegrationAccount $a) => $g->setStatus($a, $object['id'], $target),
            ($action === 'pause' ? "{$kind} pausado(a): " : "{$kind} ativado(a): ").$object['name'],
        ];
    }

    /**
     * @param  array{id: string, name: string, status: string, daily_budget: float|null, lifetime_budget: float|null, campaign_budget?: bool, adset_budgets?: bool}  $object
     * @param  array{daily_budget?: float|null, confirm_large_change?: bool}  $input
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: \Closure(AdsGateway, IntegrationAccount): void, 3: string}
     */
    private function budgetChange(IntegrationAccount $account, array $object, array $input, string $kind): array
    {
        $amount = $input['daily_budget'] ?? null;
        if ($amount === null || $amount < 1) {
            throw ValidationException::withMessages(['daily_budget' => 'Informe o novo orçamento diário (mínimo 1,00).']);
        }
        if ($object['lifetime_budget'] !== null) {
            throw ValidationException::withMessages(['daily_budget' => 'Este objeto usa orçamento total (vitalício), que não é alterado pelo Delta. Ajuste no Gerenciador de Anúncios.']);
        }
        if ($object['daily_budget'] === null) {
            throw ValidationException::withMessages(['daily_budget' => ($object['adset_budgets'] ?? false)
                ? 'Esta campanha distribui o orçamento nos conjuntos: ajuste o orçamento de cada conjunto.'
                : (($object['campaign_budget'] ?? false) ? 'O orçamento deste conjunto é definido na campanha (Advantage+): ajuste na campanha.' : 'Este objeto não tem orçamento diário próprio.')]);
        }

        $current = $object['daily_budget'];
        $ratio = abs($amount - $current) / $current;
        if ($ratio > self::LARGE_CHANGE && ! ($input['confirm_large_change'] ?? false)) {
            throw ValidationException::withMessages(['daily_budget' => sprintf(
                'Mudança de %d%% no orçamento. Saltos acima de 50%% costumam reiniciar o aprendizado da Meta; confirme para aplicar mesmo assim.',
                (int) round($ratio * 100),
            )]);
        }

        $money = fn (float $v): string => self::money($v, $account->currency);

        return [
            ['daily_budget' => $current],
            ['daily_budget' => round($amount, 2)],
            fn (AdsGateway $g, IntegrationAccount $a) => $g->setDailyBudget($a, $object['id'], $amount),
            "Orçamento diário · {$kind} {$object['name']}: {$money($current)} → {$money($amount)}",
        ];
    }

    public static function money(float $value, ?string $currency): string
    {
        $formatter = new NumberFormatter('pt_BR', NumberFormatter::CURRENCY);
        $formatted = $formatter->formatCurrency($value, $currency !== null && $currency !== '' ? strtoupper($currency) : 'BRL');

        return is_string($formatted) ? str_replace("\u{a0}", ' ', $formatted) : number_format($value, 2, ',', '.');
    }

    private static function str(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }

    private static function float(mixed $value): ?float
    {
        return is_int($value) || is_float($value) ? (float) $value : null;
    }
}
