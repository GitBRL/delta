# ADR 0004 — Premissas adotadas para iniciar a Fase 0

**Status:** provisória · 12/11/2026. Revisar quando as decisões em aberto do plano (§15) forem respondidas.

As decisões em aberto do planejamento não bloqueiam a fundação. Para começar, adotei as recomendações do próprio plano:

| Tema | Premissa | Onde aparece no código |
|---|---|---|
| Público | Agência = tenant; projeto = cliente final; empresa final é uma agência com 1 projeto | `tenants`, `projects` |
| Papéis | `owner`, `admin`, `analyst`, `client` por agência | `tenant_user.role`, `TenantRole` |
| Sessão, cache e filas | Valkey; sem tabelas `sessions`/`cache`/`jobs` | `backend/.env.example` |
| Tokens pessoais do Sanctum | Fora por enquanto; API pública usará Passport (fase 2) | — |
| Passkeys | Ativas sob RLS (ADR 0025) | `config/fortify.php` |
| Storybook | Adiado; vitrine em `/design-system` no app | `frontend` |

Nada aqui depende do provedor de WhatsApp, da hospedagem nem do nome da marca.
