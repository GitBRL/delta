<?php

declare(strict_types=1);

use App\Domain\Integrations\ConnectionManager;
use Illuminate\Support\Facades\Schedule;

// Partições mensais de metric_facts_daily sempre 12 meses à frente.
Schedule::command('metrics:partitions')->monthlyOn(1, '03:00')->onOneServer();

// Envios automáticos de relatório (e-mail e WhatsApp): verifica a cada minuto (ADR 0012).
Schedule::command('automations:dispatch')->everyMinute()->withoutOverlapping()->onOneServer();

// Sincronização diária de todas as conexões, de madrugada no fuso da agência (ADR 0012).
Schedule::command('connections:sync-daily')->dailyAt('04:00')->timezone(ConnectionManager::timezone())->onOneServer();

// Metas: avaliação diária depois da sincronização da madrugada (ADR 0017).
Schedule::command('goals:evaluate')->dailyAt('07:30')->timezone(ConnectionManager::timezone())->onOneServer();

// Publishing: posts agendados que chegaram na hora (ADR 0028).
Schedule::command('posts:publish-due')->everyMinute()->withoutOverlapping()->onOneServer();

// Billing: avisos de franquia (80% e 100%) do mês (ADR 0031).
Schedule::command('billing:usage-alerts')->hourlyAt(40)->onOneServer();

// Sync: exportações vencidas para Google Sheets, a cada hora (ADR 0027).
Schedule::command('sheets:sync-due')->hourlyAt(15)->withoutOverlapping()->onOneServer();

// Saúde dos projetos e impacto das ações aplicadas, depois da sincronização (ADR 0018).
Schedule::command('insights:daily')->dailyAt('07:45')->timezone(ConnectionManager::timezone())->onOneServer();
