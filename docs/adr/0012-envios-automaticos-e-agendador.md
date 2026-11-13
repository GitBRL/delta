# ADR 0012 — Envios automáticos, contatos e agendador entre agências

**Status:** aceita · 12/11/2026

## Contexto

Três necessidades do MVP:
- o relatório precisa sair sozinho, na agenda do cliente, por e-mail e WhatsApp;
- os destinatários precisam de consentimento rastreável (LGPD e regras da Meta);
- os dados precisam ser sincronizados todo dia.

O agendador e a sincronização diária precisam **enxergar todas as agências**, mas a aplicação roda sob RLS, sempre no contexto de uma agência.

## Decisões

1. **Contatos por projeto, com opt-in por canal** (`email_opt_in`, `whatsapp_opt_in`):
   - o telefone é guardado em E.164; sem código de país, assume +55;
   - **`contact_consents` é append-only:** `REVOKE UPDATE, DELETE` da aplicação. Cada mudança registra canal, concedido ou retirado, origem (`manual`, `unsubscribe_link`, `whatsapp_reply`), quem registrou e o IP.
2. **Descadastro em um clique, sem login:**
   - o e-mail traz um link para `/descadastrar` com parâmetros **assinados pelo Delta** (agência, contato, canal);
   - a API pública só define o contexto da agência depois de validar a assinatura (`signed:relative`);
   - o e-mail também leva o cabeçalho `List-Unsubscribe`.
3. **Automação** (`automations`):
   - **referências:** um relatório-base e os contatos do projeto;
   - **canais:** e-mail e WhatsApp;
   - **frequência:** diária, semanal, quinzenal ou mensal (dia 1 a 28), com horário **no fuso da agência**;
   - **período:** um preset relativo;
   - **mensagem:** com variáveis (`{{contato}}`, `{{cliente}}`, `{{periodo}}`, `{{agencia}}`, `{{link}}`, `{{resumo}}`);
   - **opções:** PDF anexo e "revisar antes de enviar".

   O `next_run_at` é recalculado a cada gravação e a cada execução (`Schedule`).
4. **Execução** (`automation_runs`):
   - publica um **snapshot** (ADR 0011) e então envia, ou fica `awaiting_approval`. Aprovar ou cancelar fica registrado;
   - **idempotente:** índice único em (automação, horário agendado), e a agenda é "reivindicada" com `SELECT … FOR UPDATE`. Rodar o agendador duas vezes não duplica (testado);
   - "Este mês" no dia 1 vira "mês passado": melhor enviar do que falhar.
5. **Mensagens** (`messages`):
   - uma por contato e canal (índice único);
   - **sem consentimento:** a mensagem fica `skipped`, com o motivo;
   - **status:** só avança (`queued → sent → delivered → read`). `failed` não sobrescreve uma mensagem já entregue;
   - **link público:** cada execução gera o seu, de 90 dias. Ele vai só no payload da fila; o banco guarda o hash, e o corpo guardado leva o link mascarado;
   - **e-mail:** espera o PDF ficar pronto (até cerca de 2 minutos) e então envia, se preciso só com o link.
6. **Agendador entre agências: funções estreitas que devolvem SÓ identificadores.**
   - `app.due_automations(now)` devolve pares (agência, automação) vencidos, no máximo 500 por chamada;
   - `app.connections_for_daily_sync()` devolve pares (agência, conexão) ativas ou com erro;
   - cada item vira **um job no contexto da própria agência** (`TenantScopedJob`), e todo o trabalho real acontece sob RLS. As funções não devolvem nenhum dado de negócio;
   - **agenda:** `automations:dispatch` a cada minuto e `connections:sync-daily` às 04:00 no fuso da agência. A sincronização diária ressincroniza os últimos dias, porque as conversões atribuídas com atraso mudam os números recentes.
7. **RLS:** todas as tabelas novas têm isolamento por agência e `RESTRICTIVE` só para a equipe (`app.is_staff()`). O cliente não vê contatos nem envios.
8. **Auditoria:** `contact.*`, `automation.created|updated|deleted|run_now|approved|cancelled`.

## Consequências

- O relatório enviado é sempre uma versão imutável, com link próprio e histórico de entrega por mensagem.
- **Pendente:**
  - "horário inteligente" (evitar madrugada e fim de semana);
  - envio disparado por evento (meta batida, alerta crítico);
  - fallback automático de WhatsApp para e-mail;
  - limites de envio por plano.
