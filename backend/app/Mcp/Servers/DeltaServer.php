<?php

declare(strict_types=1);

namespace App\Mcp\Servers;

use App\Mcp\Prompts\CampaignAnalysis;
use App\Mcp\Prompts\MonthlyReview;
use App\Mcp\Tools\GetMetricsData;
use App\Mcp\Tools\GetPerformanceSummary;
use App\Mcp\Tools\GetProject;
use App\Mcp\Tools\GetReportSnapshot;
use App\Mcp\Tools\ListGoals;
use App\Mcp\Tools\ListMetrics;
use App\Mcp\Tools\ListProjects;
use App\Mcp\Tools\ListReports;
use App\Mcp\Tools\ListTimelineEvents;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

/**
 * Servidor MCP do Delta (ADR 0026): os dados da agência dentro de assistentes de IA (Claude,
 * Cursor...). Autenticação pelo token da API ("Bearer dlt_…") com o escopo mcp:tools; cada
 * ferramenta exige também o escopo de leitura correspondente. Só leitura nesta versão.
 */
#[Name('Delta')]
#[Version('1.0.0')]
#[Instructions(<<<'MD'
    Servidor do Delta, plataforma de relatórios de marketing de uma agência.

    - Projeto = um cliente da agência. Comece por list_projects e use o id nas outras ferramentas.
    - Métricas usam chaves "canal:métrica" (ex.: meta_ads:cpa, ga4:sessions). Ache as chaves com list_metrics.
    - get_metrics_data devolve o valor do período, o do período de comparação e a variação. Métricas derivadas (CPA, ROAS, CTR) são recalculadas a partir dos totais.
    - get_performance_summary traz a saúde da conta e os sinais de atenção já explicados, com sugestões.
    - Responda em português do Brasil e use só números vindos das ferramentas.
    MD)]
final class DeltaServer extends Server
{
    protected array $tools = [
        ListProjects::class,
        GetProject::class,
        ListMetrics::class,
        GetMetricsData::class,
        GetPerformanceSummary::class,
        ListGoals::class,
        ListTimelineEvents::class,
        ListReports::class,
        GetReportSnapshot::class,
    ];

    protected array $prompts = [
        MonthlyReview::class,
        CampaignAnalysis::class,
    ];
}
