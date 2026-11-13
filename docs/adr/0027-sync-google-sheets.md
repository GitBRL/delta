# ADR 0027 — Sync: exportação agendada para Google Sheets

**Status:** aceita · 12/11/2026

## Contexto

O Reportei Sync exporta os dados dos canais para o Google Sheets (item 10 do plano). As agências usam a planilha para cruzar com o financeiro, montar o próprio BI ou repassar ao cliente.

## Decisões

1. **Destino é uma conexão `google_sheets`, não um canal.**
   - Usa o mesmo login em pop-up e o mesmo app do Google cadastrado pela agência (ADR 0009). O endereço de retorno `/oauth/google_sheets/callback` passa a aparecer na tela do app.
   - Os tokens ficam criptografados em `connections` e são renovados pelo `AccessTokens`, com o mesmo lock.
   - O destino não tem contas, não entra na lista de canais (`/api/connections`), não tem coleta e é ignorado na sincronização diária.
   - A lista de destinos fica em `/api/sync/destinations`.
2. **Escopo mínimo `drive.file`.** O Delta só enxerga as planilhas que ele mesmo criou, nunca o resto do Drive do usuário. A conta que autorizou é identificada por `drive/v3/about` e entra no nome do destino ("Google Sheets · ana@…").
3. **Exportação (`sheet_syncs`):**
   - **o que exporta:** projeto, destino, métricas (até 30, do catálogo, indicadores e fonte manual), janela móvel de 7 a 400 dias até ontem, frequência diária ou semanal, e se está ativa;
   - **formato:** a aba "Dados" tem uma linha por dia e uma coluna por métrica, com cabeçalho e a primeira linha congelada;
   - **valores:** os números são os mesmos da consulta de métricas, com derivadas recalculadas por dia; dias sem dado ficam em branco;
   - **planilha:** é criada na primeira execução ("Delta · projeto · nome"); nas seguintes, a aba é limpa e regravada. Se a planilha foi apagada no Drive (404), outra é criada.
4. **RLS:** isolamento por agência mais `RESTRICTIVE` com `app.is_staff()`. O cliente final não vê nem gerencia as exportações, e os jobs, sem usuário, podem rodar.
5. **Agendamento:**
   - `sheets:sync-due` roda a cada hora (minuto 15);
   - **`app.due_sheet_syncs(now)`** é uma função `SECURITY DEFINER` nova que devolve só ids (agência e exportação), no padrão da ADR 0012. Considera vencidas as exportações ativas cuja última execução tem 1 dia (ou 7) menos 10 minutos de folga, e ignora as que estão rodando há menos de 1 hora;
   - cada exportação vira um job `RunSheetSync` no contexto da agência, na fila `metrics`, único por exportação.
6. **Erros:**
   - **falha guardada:** a falha fica em `last_error`, em pt-BR;
   - **nova tentativa:** limite de chamadas e instabilidade fazem a fila tentar de novo;
   - **sem nova tentativa:** permissão negada, token expirado e erro de validação.

   Criar a exportação nunca falha por causa da primeira execução.
7. **Modo demonstração:** com o destino em demonstração, a exportação roda inteira e guarda só a prévia (cabeçalho e 15 linhas), sem chamar o Google.

## Pendente

- várias abas (uma por canal) e layout "resumo do período";
- exportação para CSV e Excel por link assinado (Power Query e Looker Studio).
