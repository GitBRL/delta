# ADR 0016 — Dashboard ao vivo (link público recalculado e modo TV)

**Status:** aceita · 12/11/2026

## Contexto

Além da versão publicada, que é congelada (ADR 0011), agências e clientes querem um painel que se atualize sozinho: na TV do escritório, ou no link que o cliente consulta a qualquer momento.

## Decisões

1. **O link público pode apontar para o relatório**, e não só para uma versão publicada:
   - `share_links.report_id`, com a regra "exatamente um entre `snapshot_id` e `report_id`" (`CHECK`);
   - o mesmo token de 40 caracteres guardado como hash, a mesma senha e validade opcionais, e a mesma contagem de visitas.
2. **`app.shared_report`** passou a devolver também o `report_id` e o `link_id`. Continua sendo uma busca exata pelo hash.
3. **O recálculo roda no contexto da agência dona do link, sem usuário:**
   - o hash do token é a prova de acesso, e a função estreita devolve o `tenant_id` (mesmo raciocínio dos links assinados de descadastro, ADR 0012);
   - só leitura: renderizador do relatório com o período relativo dele (por exemplo, "últimos 30 dias" sempre atual).
4. **Cache de 5 minutos por link** (`live-report:{link}`). Protege as APIs e o banco de TVs e de muitos acessos. A tela mostra "atualizado há X".
5. **Sem PDF no link ao vivo:** o PDF é de versão publicada, que é imutável e auditável.
6. **Modo TV** (`/r/{token}?tv=1`, no frontend):
   - tela cheia, sem ações e com relógio;
   - rotação entre as seções e recarga a cada 5 minutos;
   - respeita `prefers-reduced-motion`.

## Consequências

- O cliente tem um painel sempre atual sem login. A agência controla validade, senha e desativação.
- **Pendente:** embed por iframe com domínio autorizado (depende da hospedagem do app e dos cabeçalhos `frame-ancestors`).
