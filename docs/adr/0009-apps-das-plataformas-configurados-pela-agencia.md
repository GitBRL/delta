# ADR 0009 — Apps das plataformas configurados pela agência

**Status:** aceita · 12/11/2026

## Contexto

O login real (ADR 0008) precisa das credenciais dos apps OAuth da Meta e do Google. Até aqui elas ficavam no `backend/.env`. Quem opera o servidor não tem essas credenciais; quem tem é o administrador da agência, que não acessa o servidor. Por isso o cadastro precisa ser feito pela tela.

## Decisões

1. **Cadastro por agência.** A tabela `oauth_apps` guarda um app por agência e por fornecedor (`meta` ou `google`). Um app serve a várias plataformas:
   - o da Meta serve Meta Ads, Facebook e Instagram;
   - o do Google serve GA4 e Google Ads.

   Ela segue o padrão das outras tabelas: `tenant_id` + `Rls::tenantIsolation`.
2. **Precedência.** Valem as credenciais da agência; sem elas, valem as do servidor (`.env`), quando existirem.
   - O cadastro da agência é usado **inteiro**, sem misturar com o do servidor. O developer token do Google Ads fica preso ao projeto do Google Cloud do app.
   - Quem resolve isso é `PlatformApps`, sem cache (Octane).
3. **Quem pode, em duas camadas:**
   - **API:** o middleware `tenant.admin` libera só dono e administrador (`TenantRole::canAdministerAgency`).
   - **Banco:** além do isolamento, há políticas `RESTRICTIVE`:
     - **leitura:** só a equipe (`app.is_staff()`). O cliente nem enxerga as linhas. O analista lê, porque precisa disso para conectar contas.
     - **escrita** (`INSERT`/`UPDATE`/`DELETE`): só `app.is_tenant_admin()`, que exige usuário no contexto. Nenhum job grava credenciais.
   - `app.is_tenant_admin()` é `SECURITY INVOKER`, como `app.is_staff()`: lê `tenant_user` sob o RLS de quem chama. Nenhuma função `SECURITY DEFINER` nova.
4. **Segredos só entram.**
   - A chave secreta e o developer token são criptografados pela aplicação (cast `encrypted`, APP_KEY).
   - A API devolve só uma dica (`••••` + 4 últimos caracteres, e só se o segredo tiver 16 ou mais).
   - Na edição, segredo em branco mantém o atual.
   - A auditoria registra `oauth_app.created|updated|verified|removed` com os **nomes** dos campos alterados, nunca os valores.
5. **Verificação com a própria plataforma ao salvar** (e no botão "Testar de novo"), sem tocar em dados de usuário:
   - **Meta:** pede um token de app (`grant_type=client_credentials`). Ele só sai com ID e chave corretos. Com o token, busca o nome do app para mostrar.
   - **Google:** troca um código propositalmente inválido. `invalid_grant` significa credenciais boas; `invalid_client` significa recusadas; `redirect_uri_mismatch` significa que falta cadastrar os endereços de retorno.
   - **Sem conseguir falar com a plataforma:** salva assim mesmo e o estado fica "não verificado".
   - **Trocar uma credencial** zera a verificação anterior.
   - **Limite:** salvar e testar estão limitados a 10 por minuto.
   - O developer token do Google Ads só é conferido na primeira conexão, porque exige token de usuário.
6. **Estado visível onde importa.**
   - `/api/providers` passou a exigir `X-Tenant-Id`, porque a disponibilidade do login real agora depende da agência.
   - O aviso do card (`live_note`) diz o que falta e onde configurar: o app, o developer token do Google Ads, ou "a plataforma recusou as credenciais na última verificação".
   - Para dono e administrador, o botão bloqueado leva direto ao card do app.
7. **Tela "Integrações › Apps das plataformas"** (`/integracoes/apps`) traz:
   - o guia passo a passo com link para o console da plataforma;
   - os endereços de retorno com botão de copiar;
   - o formulário com "Salvar e verificar", "Testar de novo" e "Remover" (com confirmação).

## Consequências

- O operador do servidor não precisa das credenciais. O `.env` vira só um padrão opcional para todas as agências.
- Cada agência pode usar o próprio app. Isso vale também para white-label e para quem já tem app aprovado nas plataformas.
- Remover ou trocar o app quebra a renovação de acesso das conexões reais feitas com ele (o refresh do Google usa o mesmo cliente). A tela avisa na confirmação.
- **Endereços de retorno:** continuam sendo `{FRONTEND_URL}/oauth/{plataforma}/callback`, iguais para todas as agências. A agência sai do `state` (ADR 0008).

## Pendente

- Renovação de tokens com lock usando as credenciais da agência (junto com os coletores reais).
- Rotação da APP_KEY com recriptografia (`APP_PREVIOUS_KEYS` cobre a leitura durante a transição).
