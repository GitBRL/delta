# ADR 0020 — API pública v1 e webhooks de saída

**Status:** aceita · 12/11/2026

## Decisões

1. **Tokens por agência** (`api_tokens`):
   - formato `dlt_` + 40 caracteres, aparecem só na criação; o banco guarda o sha256 e um prefixo para identificação;
   - escopos explícitos: `projects:read`, `metrics:read`, `reports:read`, `reports:write`, `webhooks:manage`;
   - validade opcional e revogação.

   Só dono e administrador criam ou revogam, também no banco.
2. **Autenticação antes do contexto**, pelo padrão da ADR 0002:
   - **funções `SECURITY DEFINER` novas e estreitas:** `app.api_token_lookup(hash)` (busca exata) e `app.touch_api_token(id)` (atualiza `last_used_at` no máximo 1 vez por minuto);
   - **contexto do request:** o middleware `api.token` define a agência **sem usuário**. Tudo roda sob RLS, com as mesmas regras do papel da equipe, e só leitura e escrita da própria agência;
   - **escopos:** o middleware `api.scope:<escopo>` exige cada um.
3. **Os mesmos controllers do app:** a API v1 é uma camada de rotas, não uma segunda implementação. Os formatos de resposta são os mesmos documentados em `docs/api-v1.md`.
4. **Limite por token:** 120 por minuto (`api-v1`). O limitador geral da API ignora a v1, para não tentar resolver usuário pelo `Bearer`.
5. **Webhooks** (`webhook_endpoints`, `webhook_deliveries`):
   - **eventos:** `report.published`, `automation.sent|failed`, `goal.status_changed`, `connection.expired`, `action.measured` e `ping`;
   - **segredo:** criptografado, rotacionável e mostrado só na criação e na rotação;
   - **assinatura:** `X-Delta-Signature: t=<unix>,v1=HMAC-SHA256(segredo, "<t>.<corpo>")`, ao estilo Stripe;
   - **entrega:**
     - na fila `webhooks`, com 10 s de limite e sem seguir redirecionamentos;
     - 7 novas tentativas em cerca de 2 dias;
     - **20 falhas finais** desativam o endpoint;
   - **anti-SSRF** (`UrlGuard`):
     - só `https` público, sem credenciais na URL;
     - o host é resolvido e IPs privados, reservados, de loopback ou link-local são recusados. A checagem roda **no cadastro e a cada entrega**, contra DNS rebinding;
     - em ambiente local, `http` é liberado para testes;
   - **emitir nunca derruba** a operação que gerou o evento. A falha fica registrada na entrega.
6. **Políticas** das tabelas novas: isolamento por agência mais `RESTRICTIVE` ("dono/admin **ou** sem usuário"). O contexto sem usuário é o dos jobs e o da API por token.

## Consequências

- A agência integra o Delta ao BI e ao CRM dela sem login de pessoa. Os webhooks permitem automações (n8n, Make, Zapier) sem polling.
- **Pendente:**
  - OpenAPI gerado;
  - escopos por projeto;
  - reenvio manual de uma entrega pela tela.
