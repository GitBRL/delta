# ADR 0006 — Indicadores personalizados

**Status:** aceita · 12/11/2026

## Decisão

- **Tabela `custom_metrics`**, isolada por agência com RLS. Guarda nome, fórmula, referências, unidade, direção e casas decimais.
- **Chave estável.** A chave (`custom:slug`) é gerada a partir do nome na criação e **nunca muda**: outras fórmulas e relatórios a referenciam. Renomear só muda o rótulo.
- **Sempre derivado.** Um indicador é uma métrica derivada: a fórmula é aplicada sobre os **totais** do período (razão das somas), como as derivadas do catálogo.
- **`MetricSet`.** É a visão única "catálogo + indicadores da agência" usada pela consulta, pela validação e pelo preview. O `Catalog` só cuida do catálogo e delega a resolução de dependências ao `MetricSet`.
- **Funções no motor** (lista fechada): `sum`, `min`, `max`, `abs`, `round(x, 0–6)`, `coalesce`.
  - `sum`, `min` e `max` ignoram valores ausentes; `coalesce` devolve o primeiro presente.
  - Isso permite combinar plataformas que nem todo projeto tem. Exemplo: "investimento total = `sum(meta_ads:spend, google_ads:cost)`" funciona num projeto só com Meta.
  - Fora das funções, operando ausente ou divisão por zero continuam resultando em nulo ("sem dado").
- **Validação** (mensagens pt-BR prontas para o usuário):
  - sintaxe, com posição do erro;
  - função e número de argumentos;
  - referência inexistente;
  - ao menos uma métrica;
  - no máximo 20 referências;
  - **ciclos**, verificados com o indicador novo ou editado já incluído no conjunto. Assim uma edição não fecha um ciclo com indicadores existentes.
- **Exclusão** bloqueada (422) se outro indicador depende do excluído; a resposta lista quais.
- **Pré-visualização** (`POST /api/custom-metrics/preview`) calcula a fórmula não salva sobre um projeto e um período reais, para o editor mostrar o resultado ao vivo.
- **Permissões:** criar, editar, excluir e pré-visualizar é só para a equipe da agência (middleware `staff` / `RequiresStaff`). O papel cliente vê e consulta.
- **Biblioteca de 8 modelos** prontos (ROAS combinado, MER, CPA combinado, custo por sessão...). Um teste garante que todos são válidos.
