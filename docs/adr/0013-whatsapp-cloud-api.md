# ADR 0013 — WhatsApp: Cloud API oficial, modo demonstração e webhook

**Status:** aceita · 12/11/2026

## Contexto

O envio por WhatsApp precisa usar a **API oficial** da Meta. As APIs não oficiais violam os termos e podem banir o número. As credenciais (número, token, app) são da agência, e quem opera o servidor não as tem. Sem elas, a jornada precisa funcionar do mesmo jeito para demonstração.

## Decisões

1. **Configuração pela tela, por dono ou administrador** (`whatsapp_accounts`, um por agência):
   - **modo `sandbox` (padrão):** nada sai do Delta. A mensagem é registrada e "entregue" e "lida" são simuladas (`SimulateWhatsAppStatus`), então a jornada completa funciona em demonstração;
   - **modo `cloud`:**
     - ID do número, WABA, **token permanente de usuário do sistema** e **app secret**;
     - **template aprovado**, com nome e idioma;
     - o token e o app secret são criptografados e não voltam ao navegador;
     - ao salvar, o número é conferido na Graph API (`display_phone_number`, `verified_name`);
   - **escrita:** só dono ou administrador, também no banco (`RESTRICTIVE` com `app.is_tenant_admin()`).
2. **Mensagem iniciada pela empresa = template.**
   - Os parâmetros do corpo, em ordem, são: contato, cliente, período, destaques e link. Saem sem quebras de linha, conforme a regra da Meta.
   - A tela sugere o texto do template para a agência aprovar:
     > Olá, {{1}}! O relatório de {{2}} referente a {{3}} está pronto. Destaques: {{4}}. Veja o relatório completo em {{5}} . Qualquer dúvida, é só responder esta mensagem.
3. **Webhook** (`/api/webhooks/whatsapp`):
   - **verificação (GET):** `hub.verify_token` é gerado por agência e mostrado ao administrador. O banco guarda o hash para busca (`app.whatsapp_verify_token_valid`) e o valor criptografado para exibição;
   - **eventos (POST):**
     - a agência sai do `phone_number_id` (`app.whatsapp_tenant_by_phone`, que devolve só o id);
     - em seguida, **a assinatura `X-Hub-Signature-256` é conferida com o app secret daquela agência** antes de qualquer gravação;
     - com assinatura inválida, nada é gravado e o webhook responde 200, para a Meta não reenviar;
   - **status:** sobem pela mesma regra de avanço do ADR 0012;
   - **respostas:** "PARAR", "SAIR", "STOP", "CANCELAR" ou "DESCADASTRAR" retiram o consentimento de WhatsApp do contato, com registro de origem `whatsapp_reply`.
4. **Duas funções `SECURITY DEFINER` novas**, estreitas e só para `delta_app`: `app.whatsapp_tenant_by_phone(text)` e `app.whatsapp_verify_token_valid(text)`.

## Consequências

- **Para ligar o número oficial**, a agência precisa:
  - de uma conta do WhatsApp Business verificada;
  - de um número registrado na Cloud API;
  - do template aprovado;
  - de assinar o webhook do app com a URL e o token mostrados na tela.
- **Em dev:** o webhook não é alcançável pela Meta sem um túnel. O modo demonstração cobre a jornada.
- **Pendente:**
  - número da agência via Embedded Signup (fase 2);
  - palavra-chave "relatório", que devolve o último dentro da janela de 24 h;
  - cartão PNG como cabeçalho de mídia.
