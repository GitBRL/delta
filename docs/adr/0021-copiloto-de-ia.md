# ADR 0021 — Copiloto de IA com guardrails

**Status:** aceita · 12/11/2026

## Contexto

A agência quer ajuda para escrever a análise do relatório e para perguntar sobre um cliente ("o que piorou este mês?"). O risco principal de IA em relatório é o modelo **inventar números**. Há também o cuidado com dados pessoais e com custo (§7.5 do planejamento).

## Decisões

1. **Provedor:** Claude, pelo **SDK PHP oficial** (`anthropic-ai/sdk`).
   - **Modelo e esforço:** `claude-opus-5-5`, com esforço `medium` (textos curtos) e raciocínio adaptativo (padrão do modelo).
   - **Fallback de recusa no servidor ativado** (`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`): se o modelo declinar por política, a própria API tenta o substituto padrão.
   - **Interface:** o SDK fica atrás de `AiWriter`, e os testes usam um escritor falso. Nenhum teste chama a API real.
2. **Chave por agência, configurada pelo administrador**, como os apps das plataformas (ADR 0009):
   - criptografada, nunca devolvida ao navegador;
   - padrão opcional do servidor em `ANTHROPIC_API_KEY`;
   - escrita só por dono ou administrador, também no banco.
3. **Só fatos calculados vão ao modelo** (`Facts`):
   - nicho, período, métricas **já formatadas** (valor, anterior, variação, tendência, semáforo) e os pontos de atenção;
   - **nenhum dado pessoal:** nem nomes de contatos, e-mails ou telefones, nem o nome do cliente;
   - os fatos são declarados "dados, não instruções".
4. **Guardrail de números** (`NumberGuard`):
   - cada número citado no texto é normalizado (formato brasileiro, `mil`, `%`, `R$`) e precisa existir nos fatos, com folga de arredondamento. Contagens pequenas (até 12) e anos são liberados;
   - **número que não está nos fatos:** o modelo recebe **uma** correção listando os números inválidos;
   - **se persistir:** o texto volta com `verified: false` e a lista dos números, e a tela avisa antes de usar;
   - todo texto de IA volta marcado como **sugestão**, para a equipe revisar antes de chegar ao cliente.
5. **Orçamento mensal de tokens por agência** (padrão de 2 milhões). O uso é registrado em `ai_usage` (append-only) com recurso, tokens e usuário. Orçamento esgotado é bloqueado com mensagem clara.
6. **Recursos:**
   - "Escrever análise com IA" no editor de relatório: usa o estado ainda não salvo, como a prévia;
   - "Pergunte ao copiloto" no projeto: últimos 30 dias, com o modelo do nicho.

   **Acesso:** só a equipe, nunca o papel cliente.

## Consequências

- A IA acelera o trabalho sem colocar números falsos na frente do cliente.
- **Pendente:**
  - sugestões personalizadas por sinal do semáforo;
  - Studio de apresentações (fase 3);
  - medição de qualidade (avaliações) antes de ampliar o uso.
