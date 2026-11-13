# ADR 0031 — Billing: planos, limites e franquias

**Status:** aceita · 12/11/2026 · núcleo independente do provedor de pagamento

## Contexto

O plano prevê planos com limites e consumo (WhatsApp, IA, conexões), e a decisão nº 8 recomenda "franquia por plano mais pacote adicional". Ainda estão em aberto os valores, os limites exatos e o provedor de pagamento (Stripe, Asaas, Iugu...). O produto precisa do mecanismo de qualquer forma.

## Decisões

1. **Planos em `config/billing.php`:**
   - **Essencial, Pro e Agência**, cada um com limites contados, franquias mensais e recursos:
     - limites contados: projetos, pessoas da equipe, conexões reais e envios automáticos;
     - franquias mensais: mensagens de WhatsApp e tokens de IA;
     - recursos: API/webhooks, MCP, marca própria, Publishing, Studio e gestão de anúncios;
   - **valores provisórios:** os números atuais precisam ser validados, e `price_brl` é `null` ("fale com a gente");
   - **teste grátis:** 14 dias com tudo liberado (limites do Agência).
2. **Assinatura por agência** (`subscriptions`), com situação `trialing`, `active`, `past_due` ou `canceled`.
   - **No cadastro:** só se cria o **teste grátis**. A política `RESTRICTIVE` de INSERT só aceita `trial`/`trialing` quando há usuário no contexto.
   - **Mudanças:** trocar de plano, ativar ou cancelar só é possível **sem usuário no contexto**, pelo sistema (webhook do provedor ou o comando `billing:plan`). Ninguém troca o próprio plano, nem com acesso ao banco pela aplicação.
   - **Agências anteriores ao billing:** sem assinatura gravada, contam como teste grátis a partir da criação.
3. **Leitura nunca é bloqueada.** O bloqueio vale só para:
   - criar além do limite: projeto, convite de equipe (convites pendentes ocupam lugar; cliente final não conta), conexão real (conferida **antes** de abrir o pop-up da plataforma) e envio automático;
   - usar recurso fora do plano:
     - token da API (com `mcp:tools`, exige MCP) e as rotas `/api/v1` e `/mcp` (middleware `plan.feature`);
     - domínio próprio e selo oculto da marca;
     - criar post e enviar mídia;
     - Studio;
     - alterar anúncios.

   A resposta é **HTTP 402** com a mensagem em pt-BR, o limite, o permitido e o usado.
4. **Franquias do mês:**
   - **WhatsApp** conta os envios automáticos (enviada, entregue ou lida) e as respostas da caixa de entrada:
     - envio automático acima da franquia fica `skipped` com o motivo, e o envio por e-mail segue normalmente;
     - resposta na caixa de entrada acima da franquia responde 402;
   - **IA:** o orçamento efetivo é o menor entre o que a agência configurou e a franquia do plano.
5. **Teste vencido ou assinatura cancelada:** nada novo é criado, mas tudo o que existe continua visível e exportável. A IA fica com orçamento zero e as franquias também.
6. **Inadimplência (`past_due`):** continua usável (carência) até o provedor cancelar.
7. **Plano e uso** em `GET /api/billing` (dono e administrador): plano, situação, datas, limites, uso atual e catálogo.
8. **Demonstração:** a agência demo fica no plano Agência ativo.
9. **Avisos de franquia:** `billing:usage-alerts` roda a cada hora e manda e-mail a dono e administradores quando WhatsApp ou IA passam de 80% e de 100% no mês.
   - Cada limiar é avisado uma vez por mês, com controle na tabela `usage_alerts`.
   - Quem já começa acima de 100% recebe só o aviso de franquia esgotada.
   - As agências são listadas pela função `app.tenants_with_projects()`, que já existe.

## Pendente

- integrar o provedor de pagamento (checkout, portal e webhooks que atualizam a assinatura), depois da decisão;
- pacotes adicionais de WhatsApp e IA;
- validar preços e limites;
