# ADR 0018 — Detectores do semáforo, referências por nicho, saúde da conta e plano de ação

**Status:** aceita · 12/11/2026

## Decisões

1. **Mais três detectores no semáforo** (`Detectors`), além das regras de boas práticas e das metas (§7.2). Todos com **volume mínimo**:
   - **referência do nicho:** valor fora da faixa p25–p75 do nicho do projeto, e só no sentido ruim;
   - **histórico do cliente:**
     - compara os últimos 7 dias com as 4 semanas anteriores, usando a **mediana** e o **desvio absoluto mediano** das semanas. Um pico isolado não distorce a referência, e semanas inteiras neutralizam o efeito do dia da semana;
     - acusa a partir de 30% de desvio **e** acima de 3 desvios medianos, só no sentido ruim;
     - a partir de 60%, o alerta é crítico;
   - **qualidade dos dados:** conversões que zeraram ontem com tráfego normal (média ≥ 3 por dia e tráfego ≥ 50% do habitual) são um alerta crítico de rastreamento.
2. **Os sinais novos entram no mesmo formato e no mesmo avaliador.** Quando uma regra de boas práticas já diz o mesmo (mesma métrica, mesmo estado), o detector não repete o alerta.
3. **Referências por nicho** (`Benchmarks`):
   - p25, p50 e p75 por métrica e nicho, com uma base padrão;
   - **valores curados a validar com um especialista de mídia** (decisão em aberto nº 5). Depois, agregados anônimos da base, com amostra mínima.
4. **Saúde da conta (0–100):**
   - parte de 100;
   - −20 por alerta crítico, −8 por ponto de atenção;
   - −12 por meta fora do ritmo, −5 por meta em risco;
   - nível bom (≥ 80), regular (≥ 60) ou ruim;
   - a API devolve os **fatores** que explicam a nota;
   - **histórico diário** (`health_scores_daily`) para a tendência;
   - aparece por projeto na Visão geral.
5. **Plano de ação** (`actions`):
   - um sinal vira tarefa com responsável (só da equipe) e prazo;
   - **estados:** aberta, em andamento, aplicada ou descartada. Descartar exige motivo, que realimenta o ajuste das regras;
   - **feedback:** útil ou não útil;
   - **medição de impacto:** ao marcar "aplicada", grava a **linha de base** (a métrica nos 14 dias anteriores). Fechada a janela de 14 dias depois, `insights:daily` mede de novo e registra a variação e se **melhorou** (pela direção da métrica). Os dois momentos entram na linha do tempo.
6. **Rotina diária `insights:daily`** (07:45, no fuso da agência): calcula a nota de saúde de cada projeto e mede as ações. Os ids vêm de `app.tenants_with_projects()` e `app.actions_to_measure()`, no padrão da ADR 0012.

## Consequências

- A agência sabe o que mudou no cliente em relação a ele mesmo e ao mercado, e quais ações funcionaram.
- **Pendente:**
  - sugestões personalizadas por IA (com o guardrail de números da §7.5);
  - ajuste de faixas e regras por agência;
  - ciclo de vida do alerta (reconhecido/resolvido) persistido.
