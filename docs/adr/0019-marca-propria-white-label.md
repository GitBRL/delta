# ADR 0019 — Marca própria da agência (white label)

**Status:** aceita · 12/11/2026

## Decisões

1. **`brandings`**, uma por agência, com:
   - nome de exibição e cor principal (`#RRGGBB`);
   - logo;
   - opção de ocultar "Feito com Delta";
   - e-mail de resposta;
   - domínio próprio com data de verificação.

   Toda a agência lê, porque o portal do cliente usa a marca; só dono e administrador gravam, também no banco (`RESTRICTIVE` com `app.is_tenant_admin()`).
2. **Logo seguro:**
   - aceita PNG, JPG ou WebP de até 2 MB. **SVG é recusado** (pode carregar script);
   - a imagem é **decodificada e recodificada em PNG** com GD, o que descarta metadados e qualquer conteúdo embutido;
   - é redimensionada para caber em 600×200, preservando a transparência;
   - **acesso:** pelo app e por **link assinado de 10 minutos** nas páginas públicas.
3. **Onde a marca aparece:**
   - **PDF:**
     - a cor entra no gradiente da capa;
     - o logo substitui o Δ e vai como arquivo junto do HTML, porque o Gotenberg não acessa a rede;
     - o nome aparece na capa e no rodapé.
   - **Link público e dashboard ao vivo:** `branding` com nome, cor, logo e selo.
   - **E-mails de relatório:** remetente com o nome da agência e `Reply-To` para o e-mail dela. O endereço técnico de envio continua o da plataforma.
4. **Domínio próprio:**
   - a agência informa, por exemplo, `relatorios.suaagencia.com.br` e cria um CNAME para `DELTA_CNAME_TARGET`;
   - o Delta verifica pelo DNS (`DnsResolver`, substituível nos testes);
   - trocar o domínio zera a verificação.

## Consequências

- O cliente final vê a agência, não o Delta.
- **Para servir de fato o domínio próprio,** a hospedagem precisa de TLS automático por domínio (Caddy/FrankenPHP on-demand TLS, ou um proxy na borda) consultando os domínios verificados. Isso fica para o momento da implantação.
- **Pendente:**
  - temas de e-mail com o logo embutido;
  - remetente com domínio da agência (SPF/DKIM).
