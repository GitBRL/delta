# ADR 0029 — Studio: apresentações geradas por IA

**Status:** aceita · 12/11/2026

## Contexto

O Reportei Studio gera apresentações (página única ou slides) a partir de uma descrição, com ajustes por chat (item 6 do plano). O risco principal é a IA inventar números. O copiloto (ADR 0021) já resolve isso para textos curtos: só fatos calculados e um validador de números.

## Decisões

1. **A IA não escreve números de métricas: escolhe quais mostrar.** A resposta é um JSON com título e slides. Cada slide tem:
   - título;
   - narrativa curta;
   - até 6 KPIs;
   - um gráfico;
   - uma tabela de até 10 métricas.

   O Delta transforma cada slide em uma seção de relatório (blocos `text`, `kpis`, `chart` e `table`) e calcula os valores com o **mesmo renderizador dos relatórios**, para o período e a comparação escolhidos.
2. **Cardápio fechado de métricas:** só as dos canais conectados ao projeto, mais os indicadores personalizados e a fonte manual.
   - **descarte:** chave fora do cardápio é descartada, e slide que fica vazio também;
   - **revalidação:** o layout ainda passa por `ReportLayout::normalize`.
3. **Fatos e conferência:**
   - **o que o modelo recebe:** os fatos do modelo de relatório do nicho (valores, variações e sinais), mais a lista de métricas disponíveis;
   - **conferência:** depois de calcular, os textos passam pelo `NumberGuard` contra os fatos e os números da própria apresentação. Se algum número não confere, há uma rodada de correção;
   - **o que sobra:** fica em `unverified_numbers` e a tela avisa.
4. **JSON robusto:** o JSON é extraído mesmo entre crases ou com texto em volta. Se vier inválido, há uma nova tentativa com o motivo; se falhar de novo, a apresentação fica em erro com uma mensagem em pt-BR e pode ser gerada de novo.
5. **Versões:**
   - **conteúdo de cada versão:** o pedido, o JSON proposto, o layout e os números calculados (como o snapshot de relatório, a apresentação não muda sozinha);
   - **ajustes:** cada ajuste por chat manda ao modelo o pedido original, o JSON atual e a instrução, e vira uma versão nova;
   - **restauração:** dá para voltar a qualquer versão, porque nada é apagado.
6. **Mesma IA da agência** (`Copilot::complete`): mesma chave, liga/desliga, orçamento mensal e registro em `ai_usage` (`studio_generate` e `studio_revise`). Modelo Claude Opus 5.5 com fallback de recusa no servidor. A geração roda em job, porque a chamada pode levar dezenas de segundos.
7. **PDF:**
   - usa o template dos relatórios, com a marca da agência;
   - em slides, cada um vira uma página em paisagem 16:9 (11,69 × 6,58 pol.); a página única sai em A4;
   - o prompt pede no máximo 2 elementos por slide, para caber numa tela.
8. **RLS:** isolamento por agência e só a equipe (`app.is_staff()`).

## Pendente

- link público da apresentação e modo apresentação em tela cheia (frontend);
- edição manual de um slide sem passar pela IA;
- temas visuais por agência.
