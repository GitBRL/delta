# ADR 0022 — Importador do Reportei

**Status:** aceita · 12/11/2026

## Decisões

1. **O que se importa**, pela API v2 do Reportei, com o token da empresa colado pelo dono ou administrador:
   - **projetos:** idempotente por nome, então rodar de novo não duplica;
   - **marcos da linha do tempo:** o HTML vira texto e o marco é marcado com a origem `reportei`;
   - **lista de integrações:** vira um **checklist de contas para reconectar** no Delta. Tokens de terceiros não são transferíveis, e a reconexão é em um clique (ADR 0008).
2. **O que não se importa:**
   - **histórico de métricas:** os coletores do Delta trazem 400 dias ao conectar;
   - **layouts de relatório:** os do Delta vêm dos modelos por nicho.
3. **O token não é guardado:**
   - vai **criptografado no payload da fila** (`ShouldBeEncrypted`) e morre com o job;
   - a tabela `imports` guarda só o estado e o resumo (testado: nenhuma linha contém o token);
   - é validado antes de criar qualquer coisa (`/companies/settings`).
4. **Paginação e limites:**
   - `per_page=100`, até 50 páginas por recurso;
   - novas tentativas curtas;
   - token recusado vira mensagem clara.
5. **Acesso:** só dono e administrador. **Auditoria:** `import.started`.

## Pendente

- importar também relatórios e templates como modelos da agência;
- mapear métricas do Reportei para importar histórico quando a conta não puder ser reconectada.
