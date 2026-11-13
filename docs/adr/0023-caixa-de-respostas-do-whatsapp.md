# ADR 0023 — Caixa de respostas do WhatsApp

**Status:** aceita · 12/11/2026

## Decisões

1. **`whatsapp_messages`** guarda a conversa nos dois sentidos:
   - **entrada:** o que o cliente final responde ao relatório;
   - **saída:** as respostas da equipe.

   Cada mensagem é ligada ao contato pelo telefone (E.164). Isolamento por agência e só a equipe acessa (`RESTRICTIVE` com `app.is_staff()`).
2. **Entrada pelo webhook assinado** (ADR 0013):
   - toda mensagem de texto é gravada, com idempotência pelo id da Meta, num savepoint, para o reenvio não duplicar nem abortar a transação;
   - "PARAR" continua retirando o consentimento.
3. **Resposta livre só dentro da janela de 24 h** desde a última mensagem do cliente (regra da Meta para mensagens fora de template):
   - fora dela, o envio é recusado com a explicação;
   - no número oficial vai como `type: text`;
   - no modo demonstração, fica registrada sem sair do Delta.
4. **Lista de conversas:** não lidas por conversa, marcadas como lidas ao abrir, e o indicador de janela aberta com o horário em que fecha.
5. **Modo demonstração:** a ação "simular mensagem do cliente" permite testar a jornada completa sem número oficial. Ela existe só nesse modo.

## Pendente

- palavra-chave "relatório", que devolve o último relatório na hora;
- atribuição de conversa a uma pessoa da equipe;
- mídia (imagens e áudio).
