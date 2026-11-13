# ADR 0002 — Autenticação sob RLS

**Status:** aceita · 12/11/2026

## Contexto

`users` tem RLS: cada um vê a si mesmo e os colegas da agência do contexto. Mas login, restauração de sessão, "lembrar-me" e reset de senha precisam achar o usuário **antes** de existir contexto.

## Decisão

- Funções `SECURITY DEFINER` estreitas, com `search_path` fixo, executáveis só pelo `delta_app`:
  - `app.auth_user_by_id(uuid)`;
  - `app.auth_user_by_email(text)`, com comparação sem distinção de maiúsculas;
  - `app.email_taken(text, uuid)`, para validar unicidade no cadastro e na troca de e-mail.
- Provider próprio `rls-eloquent` (`App\Auth\RlsUserProvider`) usa essas funções. O contexto de usuário só é definido depois de a identidade ser comprovada: sessão válida, token "lembrar-me" conferido ou senha validada.
- Cadastro: os UUIDs do usuário e da agência são gerados na aplicação e o contexto é definido **antes** dos INSERTs. Assim as políticas `WITH CHECK` passam sem nenhum caminho que ignore o RLS.
- SPA autenticada por sessão (Sanctum stateful, cookies `httponly` + `samesite=lax`, CSRF via `XSRF-TOKEN`). Rotas do Fortify em `/auth/*`. Sessões no Valkey, criptografadas.
- 2FA TOTP (Fortify) ativo com confirmação.

## Pendente

- ~~Passkeys~~: resolvido no ADR 0025 (`app.auth_passkey_by_credential`, conferência antes do contexto).
- **Tokens de API (Passport) e MCP:** a busca de token também acontece antes do contexto; será tratada com o mesmo padrão na fase 2.
- `password_reset_tokens` é global (consultada por e-mail antes do contexto); guarda só hash do token.
