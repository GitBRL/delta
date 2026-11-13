# ADR 0024 — Canais novos: Search Console, YouTube, Perfil da Empresa, TikTok Ads e LinkedIn Ads

**Status:** aceita · 12/11/2026

## Contexto

O Reportei cobre mais canais do que os 5 do MVP. Na ordem de prioridade do §4.2, estes vinham depois:
- Search Console, YouTube e Perfil da Empresa no Google (prioridade 2);
- TikTok Ads e LinkedIn Ads (prioridade 2).

Os três canais do Google usam o mesmo app OAuth que a agência já cadastra (ADR 0009). TikTok e LinkedIn precisam de um app próprio cada.

## Decisões

1. **Dois fornecedores de app novos, `tiktok` e `linkedin`**, cadastrados pelo administrador em Apps das plataformas, como Meta e Google:
   - **App ID do TikTok:** só números.
   - **Client ID do LinkedIn:** letras e números.
   - **Developer token:** só o Google Ads tem.
   - **Banco:** a restrição `oauth_apps_vendor_check` passou a aceitar os quatro.
2. **Login do TikTok for Business:**
   - a autorização volta com `auth_code` (não `code`), e o retorno do OAuth aceita os dois;
   - o token de anunciante **não expira** e não tem refresh;
   - as contas descobertas são os anunciantes autorizados (`oauth2/advertiser/get`);
   - o TikTok não permite conferir o app sem um anunciante, então o cadastro fica "não verificado", com a explicação, até a primeira conexão.
3. **Login do LinkedIn:**
   - escopos `r_ads` e `r_ads_reporting`;
   - token de cerca de 60 dias e refresh token (1 ano) quando o app tem esse recurso;
   - a verificação do app usa um código propositalmente inválido: `invalid_client` quer dizer credenciais erradas, e erro no código quer dizer credenciais certas;
   - as contas vêm de `adAccountUsers?q=authenticatedUser`, com nome e moeda de `adAccounts/{id}`.
4. **Renovação de token (`AccessTokens`):**
   - Google e LinkedIn renovam com o refresh token, sob o mesmo lock distribuído;
   - quando o LinkedIn devolve um refresh token novo, ele substitui o anterior;
   - sem refresh token, o token vencido marca a conexão como expirada para a agência reconectar, como na Meta.
5. **Coleta do TikTok Ads:**
   - `report/integrated/get`, nível anunciante, um valor por dia, em janelas de 30 dias (limite da API);
   - o token vai no cabeçalho `Access-Token`, nunca na URL;
   - o alcance do período vem de uma consulta sem quebra diária, porque não é a soma dos dias;
   - erro de token (40102/40104/40105) pede nova autorização; limite de chamadas (40100) e instabilidade tentam de novo.
6. **Coleta do LinkedIn Ads:**
   - `adAnalytics`, pivot `ACCOUNT`, granularidade diária, em janelas de 90 dias;
   - os parâmetros Rest.li 2.0 são montados à mão: parênteses e vírgulas não podem ser codificados, só a URN dentro de `List(...)`;
   - cabeçalhos `LinkedIn-Version` (configurável) e `X-Restli-Protocol-Version: 2.0.0`;
   - campos coletados: investimento na moeda da conta, impressões, cliques, engajamentos, leads de formulário nativo e conversões da Insight Tag.
7. **Defesa nos dois coletores:** dia fora da janela pedida é descartado, para o mesmo dia não chegar duas vezes ao mesmo lote de gravação.
8. **Catálogo:**
   - **Search Console:** posição média ponderada pelas impressões.
   - **YouTube:** inscritos como fotografia do dia, saldo de inscritos aditivo.
   - **Perfil da Empresa:** impressões somam Busca e Maps; ações = ligações + cliques no site + rotas.
   - **TikTok Ads:** investimento, impressões, alcance, cliques, visualizações e conclusões de vídeo, conversões; derivadas CTR, CPC, CPM, frequência, taxa de conclusão, taxa de conversão e CPA.
   - **LinkedIn Ads:** investimento, impressões, cliques, engajamentos, leads, conversões; derivadas CTR, CPC, CPM, taxa de engajamento, CPL e CPA.
   - O LinkedIn não tem alcance no catálogo: a API só dá uma aproximação, e ela não fecha com as impressões.
9. **Relatórios e indicadores:**
   - seções padrão por canal nos modelos;
   - ordem: anúncios (Meta, Google, TikTok, LinkedIn), depois site, busca, local e social;
   - regra de CPA acima da meta ou subindo também para TikTok e LinkedIn.
10. **Demonstração:** perfis próprios e determinísticos para os cinco canais:
    - TikTok: CPM baixo e muita visualização;
    - LinkedIn: CPM alto, leads caros e queda no fim de semana.

## Pendente

- validação com contas reais, que depende de:
  - app review no TikTok for Business Developers;
  - acesso à Marketing API no LinkedIn;
  - verificação da tela de consentimento e pedido de acesso à Business Profile API no Google;
- ROAS no TikTok, com os eventos de compra do pixel por tipo;
- detalhamento por campanha nos cinco canais.
