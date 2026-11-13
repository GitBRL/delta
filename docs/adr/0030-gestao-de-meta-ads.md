# ADR 0030 — Gestão de Meta Ads

**Status:** aceita · 12/11/2026 · primeira fatia

## Contexto

Pela Fase 3 do plano, a equipe deve agir sobre as campanhas sem sair do Delta, sobretudo a partir dos sinais de atenção ("público saturando", "CPA acima da meta"). Alterar campanhas pela Marketing API exige `ads_management` (App Review). Mudar orçamento de forma brusca reinicia a fase de aprendizado da Meta.

## Decisões

1. **Escopo:**
   - **leitura:** campanhas e conjuntos das contas Meta Ads da agência, com status efetivo, objetivo, orçamento diário ou total, e investimento e resultados (compras, senão leads) dos últimos 7 dias;
   - **alteração:** pausar, ativar e mudar o **orçamento diário** de campanha ou conjunto. Orçamento total (vitalício) não é alterado.
2. **O orçamento mora num lugar só:**
   - **campanha sem orçamento próprio:** a distribuição está nos conjuntos, e a mudança é recusada com a orientação de ajustar cada conjunto;
   - **conjunto de campanha com orçamento (Advantage+):** recusado com a orientação inversa.
3. **Trava de 50%:** uma mudança acima de 50% (para mais ou para menos) exige `confirm_large_change`. A mensagem explica o risco de reiniciar o aprendizado.
4. **Idempotência:**
   - `Idempotency-Key` (8 a 80 caracteres) é opcional;
   - se a mesma chave chegar de novo, a resposta é a mudança já registrada, e nada é aplicado outra vez;
   - a chave é única por agência no banco.
5. **Registro de toda tentativa** (`ad_changes`): objeto, ação, antes e depois, quem fez, situação e erro.
   - **mudança aplicada:**
     - vira **marco na linha do tempo** dos projetos ligados à conta (`ads_change`, ex.: "Orçamento diário · Campanha X: R$ 150,00 → R$ 195,00");
     - entra na auditoria;
     - dispara o webhook `ads.changed`.
   - **mudança recusada pela Meta:** fica registrada como `failed` e a tela mostra o motivo.
6. **Meta real:**
   - os orçamentos vêm e vão em unidades menores da moeda (centavos; JPY, KRW e outras sem centavos usam fator 1);
   - a alteração é um POST no próprio objeto, e só ids numéricos são aceitos, para nunca montar um caminho arbitrário na Graph API;
   - erros: falta de permissão (códigos 10 e 200–299) pede reconexão com as permissões, e limite de chamadas e instabilidade são tratados.
7. **Demonstração:**
   - as campanhas e os conjuntos são determinísticos pelo id da conta;
   - eles são gravados (`sandbox_ad_objects`) na primeira consulta, para que pausar e mudar orçamento persistam;
   - o investimento de 7 dias acompanha o orçamento e o status.
8. **RLS:** isolamento por agência e só a equipe (`app.is_staff()`), nas duas tabelas.

## Pendente

- criar e duplicar campanhas, conjuntos e anúncios; públicos e pixels (paridade com o Connect);
- regras automáticas, como "pausar se o CPA passar de X por 3 dias", ligadas aos sinais de atenção;
- botão "aplicar" direto de um sinal de atenção ou de uma ação do plano;
- Google Ads e TikTok Ads.
