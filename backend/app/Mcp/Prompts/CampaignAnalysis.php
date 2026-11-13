<?php

declare(strict_types=1);

namespace App\Mcp\Prompts;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Prompt;
use Laravel\Mcp\Server\Prompts\Argument;

#[Name('campaign-analysis')]
#[Description('Diagnóstico da mídia paga de um cliente nos últimos 30 dias: eficiência, gargalos do funil e onde mexer na verba.')]
final class CampaignAnalysis extends Prompt
{
    public function handle(Request $request): Response
    {
        $project = $request->get('project');
        $project = is_string($project) && $project !== '' ? $project : '(pergunte qual cliente)';
        $channel = $request->get('channel');
        $scope = is_string($channel) && $channel !== '' ? "no canal {$channel}" : 'em todos os canais de anúncio conectados';

        return Response::text(<<<TXT
            Analise a mídia paga do cliente "{$project}" no Delta {$scope}, nos últimos 30 dias contra os 30 anteriores, em português do Brasil.

            1. Ache o projeto (list_projects) e leia margem e metas de CPA/ROAS (get_project).
            2. Para cada canal de anúncio, busque investimento, impressões, CPM, CTR, CPC, conversões, CPA e ROAS quando houver (get_metrics_data, period: last_30, series: true).
            3. Cruze com get_performance_summary: sinais de atenção, referências do nicho e histórico do próprio cliente.
            4. Responda: o que está eficiente, o que piorou e em que etapa do funil (alcance, clique, conversão), e para onde mover a verba, com o porquê em números.

            Regras: use só números das ferramentas; compare com a meta do projeto quando existir; não recomende mudança sem dizer qual métrica deve melhorar.
            TXT);
    }

    public function arguments(): array
    {
        return [
            new Argument('project', 'Nome do cliente (projeto) no Delta.', required: true),
            new Argument('channel', 'Canal específico (meta_ads, google_ads, tiktok_ads, linkedin_ads). Opcional.'),
        ];
    }
}
