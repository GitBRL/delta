# ADR 0015 — Fonte manual de dados

**Status:** aceita · 12/11/2026

## Contexto

Nem todo número vem de uma plataforma. Vendas da loja física, leads do CRM, receita real do caixa e base de clientes também precisam entrar nos relatórios e nos indicadores, por exemplo o "ROAS real", que é a receita lançada dividida pelo investimento em mídia.

## Decisões

1. **Métricas definidas pela agência** (`manual_metrics`):
   - chave `manual:<nome>`;
   - unidade, direção e casas decimais;
   - agregação: `sum` soma os dias do período (vendas, leads) e `last` usa o último valor lançado (estoque, base de clientes).
2. **Valores por projeto e dia** (`manual_metric_values`), num único registro por métrica, projeto e dia:
   - **lançamento em lote:** valor nulo apaga o dia;
   - **importação de planilha:**
     - **formato:** `data;valor`, com cabeçalho opcional;
     - **datas:** dd/mm/aaaa ou aaaa-mm-dd. Datas impossíveis, como 31/02, são recusadas;
     - **números:** `1.234,56`, `1,234.56` ou `R$ 10,00`;
     - **resultado:** erros apontados linha a linha, e o que estiver certo é gravado;
     - **limite:** até 2.000 linhas.
3. **Métrica como qualquer outra:**
   - o `MetricSet` da agência inclui as métricas manuais;
   - a consulta unificada lê os valores **pelo projeto**, e não por conta;
   - o resultado entra em relatórios, KPIs, séries e **fórmulas de indicadores personalizados**;
   - quem estiver sendo usado por um indicador não pode ser excluído.
4. **RLS:**
   - **leitura das definições:** toda a agência, porque o cliente precisa delas para ver os próprios relatórios;
   - **leitura dos valores:** mesmo escopo de cliente dos projetos;
   - **escrita:** só a equipe (`RESTRICTIVE` com `app.is_staff()`), também no banco (testado).
5. **Auditoria:** `manual_metric.created|deleted` e `manual_values.saved|imported`, com as contagens.

## Consequências

- A agência fecha o ciclo "mídia → venda real" sem integração com o ERP ou o CRM do cliente.
- Lançamentos mensais usam o dia de referência (ex.: o 1º do mês). A soma do período inclui os dias dentro do intervalo.
- **Pendente:**
  - importação de várias métricas na mesma planilha;
  - integração com Google Sheets (fase 3).
