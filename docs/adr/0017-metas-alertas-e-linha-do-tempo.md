# ADR 0017 — Metas, alertas e linha do tempo

**Status:** aceita · 12/11/2026

## Decisões

1. **Metas por projeto** (`goals`):
   - qualquer métrica: catálogo, indicador personalizado ou fonte manual;
   - "pelo menos" ou "no máximo", com alvo e período (mês ou semana).
2. **Progresso** (`GoalProgress`):
   - **Dados e período:** os dados vão até ontem, e no 1º dia do período é avaliado o que acabou de fechar.
   - **Métricas que acumulam** (aditivas: leads, investimento):
     - ritmo esperado = alvo × dias decorridos ÷ dias do período;
     - projeção = valor ÷ dias decorridos × dias do período;
     - "pelo menos" atingido antes do fim conta como **batida**.
   - **Métricas de nível** (CPA, ROAS, taxas, seguidores): o valor atual contra o alvo.
   - **Estados:**
     - `on_track`: no ritmo;
     - `at_risk`: até 10% fora;
     - `off_track`: fora do ritmo;
     - `achieved`: batida;
     - `no_data`: sem dados.
3. **Alertas:**
   - `goals:evaluate` roda diariamente às 07:30 no fuso da agência, depois da sincronização da madrugada;
   - as agências com metas ativas vêm de `app.tenants_with_active_goals()` (só ids, padrão da ADR 0012);
   - o alerta só sai quando **o estado muda dentro do período** (`last_status`/`last_period`), sem e-mail repetido todo dia;
   - vai um resumo por e-mail **só para a equipe**, nunca para o papel cliente, e um marco na linha do tempo.
4. **Linha do tempo** (`timeline_events`):
   - **marcos manuais**, como "Campanha de Black Friday no ar";
   - **marcos automáticos:** relatório publicado, envio concluído, meta batida, em risco ou fora do ritmo;
   - os automáticos não podem ser apagados;
   - a gravação nunca derruba a operação principal;
   - no frontend, os marcos aparecem também no gráfico do projeto.
5. **RLS:** leitura com o escopo de cliente dos projetos; escrita só da equipe.

## Consequências

- A agência vê, todo dia, o que precisa de ação. O histórico explica as variações dos gráficos.
- **Pendente:** alerta por WhatsApp para a equipe e metas com alvo por canal ou campanha.
