<?php

declare(strict_types=1);

namespace App\Mcp\Prompts;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Prompt;
use Laravel\Mcp\Server\Prompts\Argument;

#[Name('monthly-review')]
#[Description('Análise do mês de um cliente para a reunião ou o relatório: resultados, o que explica as variações e próximos passos.')]
final class MonthlyReview extends Prompt
{
    public function handle(Request $request): Response
    {
        $project = $request->get('project');
        $project = is_string($project) && $project !== '' ? $project : '(pergunte qual cliente)';

        return Response::text(<<<TXT
            Faça a análise do mês passado do cliente "{$project}" no Delta, em português do Brasil, para a agência apresentar ao cliente.

            1. Ache o projeto com list_projects e leia os dados de negócio com get_project (nicho, margem, metas de CPA e ROAS).
            2. Busque as métricas principais de cada canal conectado com get_metrics_data (period: last_month, compare: previous_period). Use list_metrics para achar as chaves.
            3. Leia get_performance_summary (saúde e sinais de atenção), list_goals e list_timeline_events do mês para explicar as variações.
            4. Escreva: resumo em 3 frases; resultados por canal com os números e a variação; o que explica as mudanças (cite os marcos da linha do tempo); metas; 3 próximos passos concretos.

            Regras: use só números que vieram das ferramentas, com a unidade certa; não invente causas; diga quando um dado está faltando.
            TXT);
    }

    public function arguments(): array
    {
        return [new Argument('project', 'Nome do cliente (projeto) no Delta.', required: true)];
    }
}
