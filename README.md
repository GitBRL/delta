# Delta

Plataforma de relatórios, dashboards e inteligência de marketing para agências, com envio configurável por WhatsApp.

- Planejamento: [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md)
- Decisões: [docs/adr/](docs/adr/)

## Requisitos

Docker e Node 24. **Não é preciso PHP no host**: o backend roda em containers.

## Primeira vez

```bash
make setup      # gera segredos locais, constrói a imagem PHP, instala dependências e migra o banco
make up         # Postgres, Valkey, Mailpit, API (http://localhost:8000), Horizon e scheduler
make front      # Angular em http://localhost:4300 (proxy /api, /auth, /sanctum → :8000)
```

Abra http://localhost:4300, crie uma conta (isso cria sua agência) e cadastre um projeto.

## Usar localmente (com dados de demonstração)

```bash
make dev        # sobe tudo (API, filas, PDF, e-mail) e o Angular em 2º plano: http://localhost:4300
make demo       # cria a "Agência Delta Demo" com 4 projetos, contas sincronizadas, relatórios e envio automático
make dev-stop   # para o Angular em 2º plano (containers: make down)
```

- Login da demonstração: `demo@delta.local`, senha `Delta-demo-2026`. Só existe no seu ambiente local.
- O `make demo` mostra os links públicos dos relatórios publicados, que abrem sem login.
- Os e-mails que o Delta envia (convites, relatórios com PDF) chegam no Mailpit: http://localhost:58025.
- O WhatsApp começa em **modo demonstração**: nada sai do Delta, e "entregue" e "lido" são simulados.
- **Depois de mudar código de jobs ou das views do PDF:** rode `make restart-workers`.

## Dia a dia

| Comando | O quê |
|---|---|
| `make test` | Testes do backend (Pest, Postgres real) |
| `make lint` | Pint + PHPStan nível máximo |
| `make front-test` | Testes do frontend (app + design system) |
| `make ci` | Tudo que precisa passar antes de considerar uma mudança pronta |
| `make migrate` / `make fresh` | Migrations (com a role dona) / recriar o banco de dev |
| `make psql` | Console SQL como `delta_app`, sujeito a RLS, para ver o que a aplicação vê |
| `make restart-workers` | Reinicia Horizon e scheduler (após mudar código de jobs) |
| `make help` | Todos os comandos |

Serviços locais: API `:8000`, Angular `:4300`, Postgres `:55432`, Valkey `:56379`, Mailpit `http://localhost:58025`, Horizon (filas) `http://localhost:8000/horizon`, Gotenberg (PDF) só na rede interna.

## Login real das plataformas (opcional)

Sem configurar nada, as conexões funcionam em **modo demonstração**, com a mesma jornada de pop-up.

Para usar o login real da Meta, do Google, do TikTok for Business e do LinkedIn, um dono ou administrador da agência cadastra os apps **pela tela**, em **Integrações › Apps das plataformas** (`/integracoes/apps`). Nada muda no servidor.
- A tela tem um guia passo a passo, os endereços de retorno para copiar no app da plataforma e a conferência das credenciais com a própria plataforma ao salvar.
- A chave secreta fica criptografada e nunca volta para o navegador.
- Opcionalmente, `META_APP_ID`/`GOOGLE_CLIENT_ID`... em `backend/.env` servem de padrão para agências que não cadastraram o próprio app.

Detalhes em [ADR 0008](docs/adr/0008-login-das-plataformas-em-popup.md) e [ADR 0009](docs/adr/0009-apps-das-plataformas-configurados-pela-agencia.md).

## Assistentes de IA (MCP) e CLI

- **Servidor MCP:** `POST /mcp` na API, com um token da API que tenha o escopo `mcp:tools` (criado em Configurações › API e webhooks). Exemplo de configuração no Claude e no Cursor em [docs/api-v1.md](docs/api-v1.md#servidor-mcp-assistentes-de-ia).
- **CLI:** `node cli/bin/delta.mjs login --url http://localhost:8000 --token -` e depois `delta projects`, `delta summary <projeto>` etc. Veja [cli/README.md](cli/README.md).

## Estrutura

```
backend/    Laravel 13 · PHP 8.5 · Eloquent · Fortify/Sanctum · Horizon · Octane (FrankenPHP)
frontend/   Angular 22 · projects/app + projects/design-system
infra/      imagem PHP · roles e bancos do Postgres
bin/        compose (com fallback sem plugin) · setup-env
cli/        CLI delta (Node, sem dependências) sobre o servidor MCP
site/       site de marketing estático (make site → http://localhost:4400)
docs/       planejamento e ADRs
```
