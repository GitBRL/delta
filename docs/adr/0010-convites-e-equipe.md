# ADR 0010 — Convites e gestão da equipe

**Status:** aceita · 12/11/2026

## Contexto

As agências precisam trazer pessoas para a equipe, com papéis diferentes:
- **administrador:** gerencia a equipe e os apps;
- **analista:** opera o dia a dia;
- **cliente:** vê só os próprios projetos.

Quem recebe o convite ainda **não é membro**. Por isso a página do convite precisa ler e gravar antes de existir contexto de agência para essa pessoa. É o mesmo problema do login (ADR 0002), resolvido pelo mesmo padrão.

## Decisões

1. **Tabela `invitations`** com `tenant_id` e RLS:
   - isolamento por agência, mais uma política `RESTRICTIVE` que usa `app.is_tenant_admin()`. Só dono e administrador enxergam ou gravam convites, também no banco;
   - **um convite pendente por e-mail por agência** (índice único parcial). Um convite vencido é revogado automaticamente quando a pessoa é convidada de novo.
2. **Token só no link.**
   - 48 caracteres aleatórios. O banco guarda o sha256.
   - Validade de **7 dias**.
   - "Reenviar" gera um link novo e invalida o anterior.
   - O link volta para quem convidou só na criação e no reenvio, para poder ser copiado. Ele também segue por e-mail, pela fila (`InvitationMail`, só com dados prontos, sem models).
3. **Duas funções `SECURITY DEFINER` novas**, estreitas e com `search_path` fixo. Executáveis só por `delta_app`.
   - `app.invitation_preview(token_hash)`:
     - busca exata pelo hash;
     - devolve só o que a pessoa precisa para decidir: nome da agência, e-mail convidado, papel, quem convidou, validade e estado (`pending|accepted|revoked|expired`).
   - `app.accept_invitation(token_hash)`:
     - aceita **como o usuário do contexto** (`app.user_id`), que precisa ter **o mesmo e-mail do convite**. A conferência é feita dentro da função, então nem uma chamada direta aceita por outra pessoa;
     - trava a linha (`FOR UPDATE`), confere validade e uso, e cria o vínculo e os acessos de cliente aos projetos escolhidos. Tudo isso numa só operação;
     - quem já é membro mantém o papel atual: o convite não rebaixa nem promove ninguém.
   - A validade é conferida pelo **relógio do banco**, que é a autoridade.
4. **Aceite pela página pública** `/convite/{token}`:
   - **logado com o e-mail certo:** aceita;
   - **logado com outro e-mail:** 403, com a orientação;
   - **sem sessão e sem conta:** cria a conta com o e-mail do convite, que fica **verificado** porque o link chegou nele, e aceita **na mesma transação**. Se o convite não valer mais, a conta não fica;
   - **sem sessão e com conta:** 409, "entre para aceitar".
5. **Regras da equipe** (`TeamMembers`):
   - só dono mexe em dono ou promove alguém a dono;
   - a agência nunca fica sem dono;
   - ninguém remove a si mesmo;
   - cliente precisa de pelo menos um projeto.

   Remover alguém apaga o vínculo e os acessos a projetos, e a pessoa perde o acesso na próxima requisição.
6. **Auditoria:** `invitation.created|resent|revoked|accepted`, `member.role_changed|removed`.

## Consequências

- Não há caminho para entrar numa agência sem um convite válido aceito pelo próprio dono do e-mail, ou sem ser incluído por um dono ou administrador.
- O papel cliente passa a ser usável de verdade. É a base do portal do cliente (fase 2).
- **Pendente:** transferência de titularidade com confirmação por e-mail; saída voluntária da agência.
