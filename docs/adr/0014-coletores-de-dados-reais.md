# ADR 0014 — Coletores de dados reais e ciclo de vida dos tokens

**Status:** aceita · 12/11/2026

## Contexto

Com o login real ligado (ADRs 0008 e 0009), as contas conectadas precisam trazer os números de verdade. O mesmo contrato `Connector` serve à demonstração e às APIs reais:
- `fetchDaily`: valores diários;
- `fetchPeriod`: o valor exato do período para métricas não aditivas.

## Decisões

1. **Um coletor por plataforma** (`App\Domain\Integrations\Live`). Todos foram testados com respostas no formato das APIs:
   - **Meta Ads** (Marketing API, insights por conta, `time_increment=1`):
     - **conversões:** compras, na ordem de prioridade `omni_purchase › purchase › pixel`. A Meta repete a mesma compra em vários tipos, então só um deles conta. Nos dias sem compra, contam os leads;
     - **receita:** `action_values` das compras;
     - **alcance do período:** consulta sem quebra diária.
   - **Página do Facebook** (Page Insights):
     - usa o **token da página**, obtido com o do usuário;
     - **uma chamada por métrica:** se a Meta descontinuar uma, as outras seguem, e a falha fica no log;
     - janelas de 90 dias;
     - publicações contadas por dia.
   - **Instagram** (Graph API):
     - **alcance diário:** em janelas de 30 dias;
     - **novos seguidores, visualizações e interações:** últimos 30 dias, que é o limite da API;
     - **seguidores:** valor atual gravado no último dia. O histórico se forma com as sincronizações diárias;
     - **alcance único:** só para períodos de até 30 dias.
   - **GA4** (Data API `runReport`):
     - métricas diárias por `date`;
     - **usuários totais:** do período exato.
   - **Google Ads** (GAQL via `searchStream`):
     - usa o developer token do app da agência;
     - o custo vem em micros;
     - a parcela de impressões, que a API devolve de 0 a 1, é gravada em %. A do período sai de uma consulta sem quebra diária.
2. **Tokens** (`AccessTokens`):
   - **Google:** renovação automática pelo refresh token, com as credenciais do app da agência, e **lock distribuído** por conexão. Quem espera o lock reaproveita o token recém-gravado.
     - `invalid_grant` marca a conexão como `expired`.
   - **Meta:** não há refresh token (o token dura cerca de 60 dias).
     - **Vencido:** a conexão vira `expired`.
     - **A 7 dias do fim:** a API marca `expiring_soon` para a tela pedir a reconexão em um clique com antecedência.
3. **Erros traduzidos** (`MetaGraph`, `GoogleApi`):
   - **Token inválido** (Meta código 190 ou HTTP 401): `ConnectorUnavailable::reauthorize`, e a conexão vira `expired`, com a mensagem "Reconecte em Integrações".
   - **Limite de chamadas ou instabilidade** (Meta 4/17/32/613/80xxx; Google 429/5xx): `LiveApiException` retentável. O job tenta de novo com backoff.
   - **Recusa definitiva** (permissão, métrica inválida, developer token sem acesso básico): `LiveApiException` não retentável. A conexão vira `error` e a mensagem aparece na tela.
4. **Na consulta** (relatórios, Visão geral): se o valor exato do período não vier, a tela mostra o aproximado e não quebra.
5. **Sincronização:**
   - ao conectar, o histórico de 400 dias;
   - de madrugada, os últimos 30 dias (ADR 0012);
   - o botão "Sincronizar agora" vale também para contas reais.

## Consequências

- Assim que o app da agência for aprovado e as contas forem conectadas, os relatórios passam a ter números reais sem nenhuma mudança de tela.
- **Validação com contas reais:** depende das aprovações (Meta App Review, acesso básico do Google Ads). Os nomes de métricas da Graph API mudam entre versões; a versão fica em `META_GRAPH_VERSION`.
- **Pendente:**
  - escolher quais contas descobertas importar;
  - `login-customer-id` para contas acessadas via MCC;
  - quebra por campanha (fase 2).
