# ADR 0011 — Relatórios, versões publicadas, links públicos e PDF

**Status:** aceita · 12/11/2026

## Contexto

O relatório é o produto central. Ele precisa de:
- um montador flexível;
- números que **não mudam depois de enviados**, mesmo que o relatório seja editado ou os dados sejam ressincronizados;
- um link aberto para o cliente final, que não tem login;
- um PDF fiel ao visual da tela.

## Decisões

1. **Três tabelas** (migration 000012):
   - **`reports`:** o rascunho editável, com layout JSONB de seções e blocos;
   - **`report_snapshots`:** a versão publicada, com os dados prontos congelados em `data`;
   - **`share_links`:** o link público de um snapshot.
2. **Layout validado numa única porta** (`ReportLayout::normalize`):
   - **5 tipos de bloco:**
     - `kpis`: até 12 métricas;
     - `chart`: uma métrica, com a série diária e a comparação;
     - `table`: até 20 métricas;
     - `text`: até 5.000 caracteres;
     - `attention`: até 10 sinais do semáforo;
   - **limites:** até 30 seções, e até 30 blocos por seção;
   - as métricas são conferidas contra o catálogo e os indicadores da agência;
   - campos desconhecidos são descartados e os ids ficam garantidos como únicos.
3. **Um só formato de dados** (`ReportRenderer`) para a prévia do montador, o snapshot, o PDF e o link público. São duas consultas (valores e séries dos gráficos) e uma avaliação do semáforo. Quando o bloco mistura canais, cada métrica traz o canal.
4. **Modelos por nicho no código** (`ReportTemplates`, 6 modelos):
   - ao criar, entram só as seções dos canais ligados ao projeto;
   - o modelo padrão é o do nicho do projeto.
5. **Período relativo ou fixo** (`ReportPeriod`):
   - presets: últimos 7, 14 ou 30 dias, mês passado, este mês, ou personalizado;
   - os presets são recalculados a cada publicação;
   - os dados vão até **ontem**, no fuso da agência;
   - o máximo é de 400 dias.
6. **Snapshot imutável no banco:**
   - `REVOKE UPDATE` da aplicação, com `GRANT UPDATE` só nas colunas do PDF (`pdf_status`, `pdf_path`, `pdf_error`, `updated_at`);
   - tentar mudar os números dá `permission denied` (testado).
7. **RLS:**
   - isolamento por agência;
   - **cliente:** só lê relatórios e versões dos projetos em que é membro (`RESTRICTIVE` para `SELECT`);
   - **escrita:** só a equipe (`RESTRICTIVE` com `app.is_staff()` para `INSERT`/`UPDATE`/`DELETE`);
   - **links públicos:** só a equipe enxerga e gerencia.
8. **Link público sem login:**
   - token de 40 caracteres, guardado só como sha256;
   - validade opcional (1 a 365 dias) e senha opcional (bcrypt);
   - desativação a qualquer momento e contagem de visitas;
   - **duas funções `SECURITY DEFINER` novas**, estreitas e com busca exata pelo hash, executáveis só por `delta_app`:
     - `app.shared_report(token_hash)`: devolve o snapshot e o estado do link;
     - `app.count_report_view(token_hash)`: incrementa as visitas, só se o link for válido;
   - **link com senha:** os dados só saem no `unlock`, limitado a 10 tentativas por minuto;
   - **PDF pelo link:** sai por **URL relativa assinada** de 10 minutos, entregue junto com os dados. A senha não precisa trafegar de novo.
9. **PDF pelo Gotenberg** (Chromium), serviço interno do compose:
   - sem JavaScript (`--chromium-disable-javascript`) e só com acesso aos próprios arquivos enviados (`--chromium-allow-list=^file:///tmp/.*`). Mesmo que algum texto escapasse, ele não buscaria nada na rede;
   - o HTML é gerado por Blade, com os gráficos em **SVG gerado no servidor** e a formatação pt-BR igual à do design system (`MetricFormat`);
   - o texto da agência é sempre escapado antes de virar negrito, lista ou parágrafo (`TextBlock`);
   - job `RenderSnapshotPdf` na fila `render`: 3 tentativas com backoff, e `failed` registra o motivo. A equipe pode pedir de novo;
   - o arquivo fica no disco local privado (`reports/{tenant}/{snapshot}.pdf`).
10. **Auditoria:**
    - `report.created|deleted|published`;
    - `report.snapshot_deleted`;
    - `share_link.created|revoked`.

## Consequências

- O que o cliente recebeu é exatamente o que foi publicado, para sempre.
- Os envios automáticos (e-mail e WhatsApp) passam a publicar um snapshot e mandar o link e o PDF dele.
- **Em dev:** depois de mudar views do PDF, rode `make restart-workers`, porque o OPcache do Horizon segura a view compilada.
- **Pendente:**
  - modelos salvos pela própria agência;
  - capa e cores da marca (white label, fase 2);
  - PNG do "cartão" para o WhatsApp.
