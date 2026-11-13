<?php

declare(strict_types=1);

namespace App\Domain\Automations;

use App\Domain\Integrations\ConnectionManager;
use App\Models\Automation;
use Carbon\CarbonImmutable;

/** Próximo envio de uma automação, no fuso da agência (devolvido em UTC). */
final class Schedule
{
    public static function next(Automation $automation, CarbonImmutable $after): CarbonImmutable
    {
        $tz = ConnectionManager::timezone();
        $local = $after->setTimezone($tz);
        [$hour, $minute] = array_map('intval', explode(':', substr($automation->send_time, 0, 5)));
        $at = fn (CarbonImmutable $day): CarbonImmutable => $day->setTime($hour, $minute);

        switch ($automation->frequency) {
            case 'daily':
                $next = $at($local);
                if ($next->lte($local)) {
                    $next = $at($local->addDay());
                }
                break;

            case 'weekly':
            case 'biweekly':
                $weekday = $automation->weekday ?? 1;
                $next = $at($local)->addDays(($weekday - $local->dayOfWeekIso + 7) % 7);
                if ($next->lte($local)) {
                    $next = $next->addWeek();
                }
                if ($automation->frequency === 'biweekly' && $automation->last_run_at !== null) {
                    $earliest = CarbonImmutable::parse($automation->last_run_at)->setTimezone($tz)->addDays(13);
                    while ($next->lt($earliest)) {
                        $next = $next->addWeek();
                    }
                }
                break;

            default: // monthly
                $day = max(1, min(28, $automation->month_day ?? 1));
                $next = $at($local->setDate($local->year, $local->month, $day));
                if ($next->lte($local)) {
                    $next = $at($local->startOfMonth()->addMonthNoOverflow()->setDay($day));
                }
        }

        return $next->utc();
    }

    /** "Toda segunda às 09:00", "Todo dia 5 às 08:30"... */
    public static function describe(Automation $automation): string
    {
        $time = substr($automation->send_time, 0, 5);
        $weekdays = [1 => 'segunda', 2 => 'terça', 3 => 'quarta', 4 => 'quinta', 5 => 'sexta', 6 => 'sábado', 7 => 'domingo'];
        $weekday = $weekdays[$automation->weekday ?? 1];
        $article = in_array($automation->weekday, [6, 7], true) ? 'Todo' : 'Toda';

        return match ($automation->frequency) {
            'daily' => "Todos os dias às {$time}",
            'weekly' => "{$article} {$weekday} às {$time}",
            'biweekly' => "A cada duas semanas, {$weekday} às {$time}",
            default => 'Todo dia '.($automation->month_day ?? 1)." às {$time}",
        };
    }
}
