# ADR 0007 — Semáforo de atenção (versão do MVP)

**Status:** aceita · 12/11/2026

## Decisão

- **Calculado na hora, sem persistência.** `POST /api/projects/{id}/attention` avalia as regras sobre o período escolhido. O ciclo de vida dos alertas (aberto → reconhecido → resolvido), o Radar global e a medição de impacto das sugestões ficam para a fase 2, como previsto no plano.
- **Regras em código** (`RuleBook`), com 15 regras iniciais em três tipos:

  | Tipo | O que verifica |
  |---|---|
  | `ThresholdRule` | faixa de boas práticas, acima ou abaixo de um limite |
  | `ChangeRule` | piora em relação ao próprio histórico; "piorar" segue a direção da métrica |
  | `CallbackRule` | lógica própria: metas do projeto e qualidade dos dados |

- **Proteções contra ruído:**
  - **volume mínimo:** sem impressões ou sessões suficientes, a regra não dispara;
  - **regras só das plataformas vinculadas** ao projeto.
- **Três janelas,** cada uma comparada com o período imediatamente anterior:
  - o período escolhido;
  - os últimos 7 dias (frequência, ritmo de publicação);
  - os últimos 3 dias (conversões que pararam de chegar).
- **Metas do projeto** (`projects.settings`, editadas via `PATCH /api/projects/{id}` em `goals`):
  - **margem bruta:** dela sai o ROAS de equilíbrio, 100 ÷ margem;
  - **meta de CPA:** o alerta usa a meta; sem ela, cai para a variação contra o período anterior;
  - **meta de ROAS:** armazenada; ainda não é usada por nenhuma regra (pendente).
- **Sinal:** estado (`critical` / `attention` / `opportunity`), título, explicação com os números formatados em pt-BR, sugestão do que fazer e evidências numéricas. O mapa `statuses` dá o estado de cada métrica avaliada, incluindo `healthy`, para os KPIs mostrarem o selo.
- **Papel cliente:** pode ver o semáforo dos projetos dos quais é membro, mas não pode editar as metas.

## Limites conhecidos

- **Pontos de partida, não verdade de mercado.** Os limites (frequência 3/4, CTR 0,8%/0,5%, CPM +30%/+50%, engajamento −30%...) **precisam ser validados por um especialista de mídia** antes do lançamento. Depois, devem ser ajustáveis por agência e por nicho.
- **Regras dependem das métricas do catálogo.** Algumas regras previstas no plano (índice de qualidade, termos de pesquisa, avaliações do Meu Negócio, abandono de carrinho) chegam junto com as métricas e conectores correspondentes.
- **Indicadores personalizados ainda sem faixas.** Eles ainda não têm faixas de atenção definidas pela agência (§7.1); fica para a próxima iteração.
- **Sem IA nas sugestões.** As sugestões são textos curados (playbook). A personalização por IA, com os guardrails de §7.5, é da fase 2.
