# ADR 0028 — Publishing: calendário, aprovação do cliente e publicação agendada

**Status:** aceita · 12/11/2026 · primeira fatia

## Contexto

O Reportei Flux agenda posts, mostra o calendário e colhe a aprovação do cliente (item 9 do plano). A publicação real pelas APIs exige App Review: na Meta, `instagram_content_publish` e `pages_manage_posts`. O produto precisa funcionar de ponta a ponta antes disso, como já acontece com os canais de dados.

## Decisões

1. **Biblioteca de mídia** (`media_assets`, por agência e opcionalmente por projeto):
   - **imagens:** o tipo é conferido pelo conteúdo (finfo), não pela extensão. Elas são decodificadas e **recodificadas em JPEG** (no máximo 2160 px no lado maior, fundo branco). O JPEG é o formato que o Instagram exige, e a recodificação descarta metadados e conteúdo embutido;
   - **vídeos:** MP4 e MOV, também conferidos pelo conteúdo, guardados como vieram;
   - **limite:** 100 MB. O `delta.ini` dos containers PHP sobe `upload_max_filesize`.
2. **Arquivo por link assinado com a agência embutida** (`/api/public/media/{tenant}/{asset}`, `signed:relative`), porque `<img>` não manda cabeçalhos. A rota roda no contexto da agência do link:
   - **app e página de aprovação:** link relativo, válido por 30 minutos;
   - **redes:** link absoluto (`APP_URL`), válido por 6 horas, porque a rede baixa a mídia;
   - **cabeçalhos da resposta:** `nosniff`, `inline` e cache privado.
3. **Posts por projeto** (`posts`) e **destinos** (`post_targets`), cada destino com rede, formato e conta:
   - **contas:** perfil do Instagram, página do Facebook ou canal do YouTube, sempre uma conta conectada e **ligada ao projeto**;
   - **regras por rede e formato** (`Networks`):
     - Instagram: feed com 1 mídia; carrossel com 2 a 10; Reels com 1 vídeo; Story com 1 mídia; até 30 hashtags;
     - Facebook: feed com texto, até 10 imagens ou 1 vídeo;
     - Shorts: 1 vídeo e título de até 100 caracteres;
     - todas: limite de legenda;
   - **problemas:** o que falta aparece no post (`problems`) e impede aprovação, agendamento e publicação. O rascunho pode ficar incompleto.
4. **Ciclo de vida:**
   - rascunho → em revisão → aprovado ou ajustes pedidos → agendado → publicando → publicado ou falhou; também é possível cancelar;
   - editar texto, mídia ou redes depois de pedir ou receber a aprovação **volta para rascunho**: a aprovação não vale para outro conteúdo;
   - post em revisão já com data é **agendado sozinho** quando o cliente aprova;
   - a aprovação pode ser desligada por post, para conteúdo interno.
5. **Aprovação do cliente por link** (`post_approvals`):
   - **token:** 48 caracteres e 14 dias de validade. O banco guarda o hash (para a busca) e o token **cifrado**, para a equipe copiar o link de novo;
   - **função nova `app.post_approval_by_token(hash)`:** `SECURITY DEFINER`, devolve só ids e datas;
   - **o resto:** roda no contexto da agência do link, sem usuário;
   - **página pública:** marca da agência, projeto, legenda, mídias e redes, sem link nem dados internos;
   - **decisão:** "Aprovar" ou "Pedir ajuste" (com comentário obrigatório) e nome opcional. É de uso único, e um pedido novo invalida o anterior;
   - **aviso:**
     - por e-mail aos contatos do projeto com consentimento, com o nome e o e-mail de resposta da agência;
     - por WhatsApp em texto livre só dentro da janela de 24 h do contato. Fora dela, a equipe envia o link manualmente, porque template de aprovação depende de aprovação da Meta.
6. **Publicação:**
   - **agendador:** `posts:publish-due` roda a cada minuto, com a função nova **`app.due_posts(now)`**. Ela devolve só ids e inclui posts presos em "publicando" há mais de 30 minutos;
   - **job:** `PublishPost` roda na fila `publish`, único por post;
   - **tomada atômica:** o UPDATE condicionado ao status impede que dois workers publiquem o mesmo post;
   - **idempotente por destino:** um destino publicado não sai de novo;
   - **vídeo em processamento:** o destino volta para a fila, e o job tenta de novo em 30 segundos, por até cerca de 15 minutos;
   - **destino interrompido:** se ficou "publicando" (queda do worker), **não é republicado às cegas**. Ele vira falha, com a orientação de conferir na rede.
7. **Publicadores:**
   - **demonstração:** conta em demonstração simula a publicação;
   - **Instagram:** contêiner, ou itens do carrossel; espera do status `FINISHED`; `media_publish`; permalink. O id do contêiner fica no destino e não é recriado na nova tentativa;
   - **Facebook:** feed com texto, foto, várias fotos (enviadas sem publicar e anexadas) ou vídeo, com o token da página;
   - **indisponíveis para contas reais:** Reels e Stories do Facebook e Shorts do YouTube falham com a orientação de publicar manualmente;
   - **sem conta:** destino cuja conta foi removida falha, nunca "publica" de mentira;
   - **erros da Graph API:** 190 pede reconexão; 10 ou 200–299 dizem que falta a permissão; limite de chamadas e instabilidade tentam de novo.
8. **RLS:**
   - mídia, posts e destinos: isolamento por agência, leitura do cliente só nos projetos dele, gravação só pela equipe;
   - pedidos de aprovação: só a equipe.

   Nos jobs e na página pública, sem usuário, `app.is_staff()` vale verdadeiro, por desenho.
9. **Webhooks:** `post.approved`, `post.changes_requested`, `post.published` e `post.failed`.

## Pendente

- Threads, LinkedIn (páginas), Pinterest e YouTube Shorts reais, que pedem conexões novas com escopos de publicação;
- pedir as permissões de publicação no login da Meta, depois do App Review;
- template de WhatsApp `aprovacao_post` com botões, e aprovação pelo portal do cliente;
- capa e primeiro comentário; marcação de pessoas; upload em partes para vídeos acima de 100 MB.
