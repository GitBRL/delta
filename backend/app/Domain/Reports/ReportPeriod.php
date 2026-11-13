<?php

declare(strict_types=1);

namespace App\Domain\Reports;

use App\Domain\Integrations\ConnectionManager;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * Período de um relatório: um preset relativo (recalculado a cada publicação, como "últimos
 * 30 dias") ou datas fixas. Os dados vão até ONTEM, no fuso da agência. Mesmas regras do
 * frontend (core/metrics/period.ts).
 */
final readonly class ReportPeriod
{
    public const PRESETS = [
        'last_7' => 'Últimos 7 dias',
        'last_14' => 'Últimos 14 dias',
        'last_30' => 'Últimos 30 dias',
        'last_month' => 'Mês passado',
        'this_month' => 'Este mês',
        'custom' => 'Personalizado',
    ];

    public const MAX_DAYS = 400;

    private function __construct(
        public CarbonImmutable $start,
        public CarbonImmutable $end,
    ) {}

    /** Intervalo do preset (ou das datas fixas). Lança erro de validação quando não há dias com dados. */
    public static function resolve(string $preset, ?string $start = null, ?string $end = null, ?CarbonImmutable $today = null): self
    {
        $today = ($today ?? CarbonImmutable::now(ConnectionManager::timezone()))->startOfDay();
        $yesterday = $today->subDay();

        $range = match ($preset) {
            'last_7', 'last_14', 'last_30' => [$yesterday->subDays((int) substr($preset, 5) - 1), $yesterday],
            'last_month' => [$today->subMonthNoOverflow()->startOfMonth(), $today->subMonthNoOverflow()->endOfMonth()->startOfDay()],
            'this_month' => $today->day === 1 ? null : [$today->startOfMonth(), $yesterday],
            'custom' => $start !== null && $end !== null ? [CarbonImmutable::parse($start)->startOfDay(), CarbonImmutable::parse($end)->startOfDay()] : null,
            default => throw ValidationException::withMessages(['period_preset' => 'Período desconhecido.']),
        };

        if ($range === null) {
            throw ValidationException::withMessages(['period_preset' => $preset === 'this_month'
                ? 'Hoje é dia 1: "Este mês" ainda não tem dias com dados. Use "Mês passado".'
                : 'Informe as datas de início e fim.']);
        }

        [$from, $to] = $range;
        if ($to->lt($from)) {
            throw ValidationException::withMessages(['period_end' => 'A data final precisa ser igual ou posterior à inicial.']);
        }
        if ($to->gt($yesterday)) {
            throw ValidationException::withMessages(['period_end' => 'Os dados vão até ontem; escolha uma data final anterior.']);
        }
        if ($from->diffInDays($to) + 1 > self::MAX_DAYS) {
            throw ValidationException::withMessages(['period_end' => 'O período pode ter no máximo '.self::MAX_DAYS.' dias.']);
        }

        return new self($from, $to);
    }

    /** "01/10/2026 – 31/10/2026" */
    public function label(): string
    {
        return $this->start->equalTo($this->end)
            ? $this->start->format('d/m/Y')
            : $this->start->format('d/m/Y').' – '.$this->end->format('d/m/Y');
    }
}
