# Delta — Frontend

Workspace Angular 22 com dois projetos:

- `projects/app` — aplicação (standalone, zoneless, Signals, rotas lazy, Tailwind CSS v4).
- `projects/design-system` — biblioteca `design-system` (prefixo `ds-`), inspirada no Apple HIG.
  Tokens em `projects/design-system/src/styles/` (`tokens.css`, `tailwind-theme.css`, `base.css`).

O app importa a biblioteca direto do código-fonte (`tsconfig.json` → `paths`), sem build prévio.

## Comandos

```bash
npm install
npm start           # http://localhost:4300 (proxy de /api, /auth, /sanctum, /oauth → http://localhost:8000)
npm run build       # build de produção do app (dist/app)
npm run build:ds    # empacota a biblioteca (dist/design-system)
npm test            # Vitest: app + design-system
npm run lint        # ESLint (angular-eslint)
```

Em máquinas com pouca RAM: `export NODE_OPTIONS=--max-old-space-size=1536` antes dos comandos.

## Rotas

| Rota | Acesso | Conteúdo |
|---|---|---|
| `/login`, `/cadastro` | visitante | Login (com 2FA) e cadastro |
| `/overview` | autenticado | Visão geral — **dados mock** (`features/overview/overview.mock.ts`) |
| `/projetos` | autenticado | Lista e criação de projetos (API real, header `X-Tenant-Id`) |
| `/design-system` | público | Vitrine de todos os componentes (substitui o Storybook por ora) |

## Integração com o backend (Sanctum SPA)

- `GET /sanctum/csrf-cookie` antes de login/cadastro; cookie `XSRF-TOKEN` → header `X-XSRF-TOKEN`.
- Interceptors (`core/http/interceptors.ts`): credenciais nas rotas do backend, `X-Tenant-Id` em `/api/*`,
  401 → login, 403/5xx/rede → toast.
- No backend: `SANCTUM_STATEFUL_DOMAINS` deve incluir `localhost:4300` (a porta 4200 é usada por outro projeto da máquina).
