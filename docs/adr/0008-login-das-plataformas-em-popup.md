# ADR 0008 — Login das plataformas em pop-up ("um clique")

**Status:** aceita · 12/11/2026

## Contexto

Conectar uma conta precisa ser um clique: abrir a tela da plataforma em outra janela, autorizar e voltar já conectado. É o padrão OAuth 2.0 com código de autorização.

## Decisões

1. **Rotas web na origem do app.** O fluxo usa `GET /oauth/{plataforma}/start`, `/callback` e `/demo`. Em dev elas são encaminhadas pelo proxy do Angular. Assim:
   - o redirect cadastrado nos apps das plataformas é `{FRONTEND_URL}/oauth/{plataforma}/callback`;
   - o cookie de sessão (`SameSite=Lax`) chega no retorno, porque é uma navegação GET de primeiro nível.
2. **O pop-up abre síncrono no clique.** A URL já é a de `start`, que redireciona para a plataforma; nenhuma chamada assíncrona antes, então o navegador não bloqueia. Se bloquear mesmo assim, o mesmo fluxo roda na própria aba (`return=redirect`) e volta para `/integracoes?oauth=...`.
3. **Resultado entregue por três canais.** As páginas do Google e da Meta podem usar COOP e **cortar o vínculo `window.opener`**; quando isso acontece, `popup.closed` vira verdadeiro no meio do login. Por isso:
   - a página de retorno avisa por `postMessage` (origem fixa do app), `BroadcastChannel('delta-oauth')` e `localStorage`;
   - o app deduplica pelo `flow` e não usa `popup.closed` como cancelamento;
   - a espera tem botão "Cancelar" e tempo limite de 10 minutos.
4. **O `state` é `{tenant_id}.{43 caracteres aleatórios}`.**
   - No banco fica só o hash, com usuário, plataforma, modo, `flow` e validade de 10 minutos.
   - É de **uso único**: a marca de uso é gravada antes de qualquer chamada à plataforma.
   - Como a agência sai do próprio `state`, o registro é buscado **sob RLS**, sem função `SECURITY DEFINER`.
   - Não serve para outro usuário, outra agência ou outra plataforma.
5. **PKCE (S256) no Google.** A Meta usa troca para token de longa duração (~60 dias, sem refresh token).
6. **Só a equipe da agência** inicia ou conclui conexões; o papel cliente não.
7. **Tokens** ficam em `connections.credentials` criptografados (cast `encrypted:array`) e nunca voltam ao navegador.
   - Na Meta, o token vai no cabeçalho `Authorization`, não na URL.
8. **Proteções das páginas do fluxo:**
   - CSP `default-src 'none'` com nonce para o script e o estilo inline;
   - `Cross-Origin-Opener-Policy: unsafe-none` (a nossa página não corta o vínculo), `Cache-Control: no-store` e `Referrer-Policy: no-referrer`;
   - limite de 30 requisições por minuto.
9. **Modo demonstração com a mesma jornada.** Uma tela de autorização do próprio Delta, marcada como demonstração e sem pedir senha, percorre o mesmo caminho do pop-up. As contas e os dados vêm do `SandboxConnector`.
10. **Login real liga sozinho com as credenciais.** Com as credenciais configuradas, o login real da Meta (Meta Ads, Facebook, Instagram) e do Google (GA4, Google Ads) fica ativo e as **contas reais são descobertas**.
    - A **coleta de dados reais** ainda não existe (`ConnectorRegistry::hasLiveConnector` = falso). A conexão fica ativa, a ressincronização responde 422 com explicação e a tela mostra o aviso (`live_note`).

## Como ligar o login real

> Atualizado pela ADR 0009: as credenciais são cadastradas **pela tela**, por um dono ou administrador da agência, em **Integrações › Apps das plataformas** (`/integracoes/apps`). A tela mostra os endereços de retorno para copiar e confere as credenciais com a plataforma ao salvar. O `backend/.env` (`META_APP_ID`, `GOOGLE_CLIENT_ID`...) ficou só como padrão opcional do servidor.

1. **Meta:** crie um app em developers.facebook.com, do tipo Business, com o produto "Login do Facebook".
   - Cadastre como URI de redirecionamento os endereços mostrados na tela (em dev: `http://localhost:4300/oauth/meta_ads/callback`, `/oauth/facebook/callback` e `/oauth/instagram/callback`).
   - Cole o ID do app e a chave secreta (Configurações › Básico) na tela.
   - Em modo desenvolvimento, só administradores e testadores do app conseguem autorizar. Em produção, as permissões precisam passar pela App Review.
2. **Google:** crie um "ID do cliente OAuth" (aplicativo da Web) no Google Cloud.
   - Cadastre os redirects mostrados na tela (`/oauth/ga4/callback` e `/oauth/google_ads/callback`).
   - Ative as APIs Google Analytics Admin e Google Ads.
   - Cole o ID do cliente e a chave secreta. Para o Google Ads, também o developer token.
   - Em modo "teste", só os usuários de teste cadastrados conseguem autorizar.

## Pendente

- Coletores de dados reais por plataforma (Graph API, Google Ads API, GA4 Data API) e a renovação automática de tokens com lock distribuído.
- Aviso quando o token da Meta estiver perto de expirar, com reconexão em um clique.
- Seleção de quais contas descobertas importar, quando a autorização der acesso a muitas.
