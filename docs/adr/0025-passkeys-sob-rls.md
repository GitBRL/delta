# ADR 0025 — Passkeys sob RLS

**Status:** aceita · 12/11/2026 · completa o pendente do ADR 0002

## Contexto

O Fortify traz passkeys (WebAuthn) pelo pacote `laravel/passkeys`. O login por passkey procura a credencial em `passkeys` pelo `credential_id` antes de existir qualquer contexto, e o RLS esconde essa linha. Pelo ADR 0002, buscas antes do contexto passam por funções `SECURITY DEFINER` estreitas.

## Decisões

1. **Tabela `passkeys`**:
   - `user_id` uuid, `credential_id` único, `credential` jsonb, `last_used_at`;
   - RLS com a política `passkeys_owner`: cada pessoa só lê, cria, altera e remove as próprias passkeys, mesmo dentro da mesma agência.
2. **`app.auth_passkey_by_credential(text)`**, `SECURITY DEFINER`, com `search_path` fixo e executável só pelo `delta_app`:
   - devolve no máximo a linha daquela credencial. O conteúdo é a chave pública e o contador de assinaturas, que não são segredos;
   - é `VOLATILE` e trava a linha (`FOR UPDATE`) até o fim da transação de quem chamou. Assim, duas tentativas com a mesma assinatura não passam juntas pela conferência do contador.
3. **`RlsVerifyPasskey`** substitui a ação do pacote:
   - acha a credencial pela função;
   - confere a assinatura (`userVerification: required`);
   - só então define o contexto do usuário;
   - grava o contador e o último uso.

   Assinatura inválida, contador que não avançou (clone ou repetição) e origem errada viram erro de validação (422), não 500.
4. **`RlsStorePasskey`** substitui o cadastro:
   - a checagem de duplicidade do pacote só enxerga as passkeys da própria pessoa; a de outra conta é barrada pelo índice único, num savepoint, e vira 422;
   - atestado recusado vira 422.
5. **Rotas do Fortify em `/auth`:**
   - `passkeys/login/options` e `passkeys/login`: só para quem não está logado, com limite por credencial e IP;
   - `user/passkeys/options`, `user/passkeys` e `user/passkeys/{id}`: cadastrar e remover exigem senha confirmada (423 sem ela).

   A listagem, que o pacote não tem, fica em `GET /api/me/passkeys`, sem expor a credencial.
6. **Passkey vale como segundo fator.** A verificação do usuário (biometria ou PIN) é obrigatória, então entrar por passkey não pede o código TOTP.
7. **RP ID e origens:**
   - o RP ID é o domínio da SPA (`FRONTEND_URL`, ou `PASSKEYS_RP_ID`);
   - as origens aceitas são `FRONTEND_URL` e `APP_URL`;
   - **passkeys não funcionam no domínio próprio de white label**: lá, o login é por senha;
   - o identificador do usuário enviado ao autenticador é um HMAC do id. A chave vem de `PASSKEYS_USER_HANDLE_SECRET`, ou da `APP_KEY`; fixe a primeira antes de girar a segunda.
8. **Mensagens do pacote em pt-BR** por `lang/pt_BR.json`.

## Testes

As cerimônias são montadas de verdade no teste, como faria o navegador: chave P-256, atestado "none", dados do autenticador, clientDataJSON e assinatura ECDSA. Cobrem:
- cadastro;
- login sem contexto;
- avanço do contador;
- recusa de repetição e de chave errada;
- credencial desconhecida;
- remoção só pela dona e com senha confirmada;
- isolamento entre colegas.

## Pendente

- auditoria de cadastro e remoção de passkey. Hoje `audit_logs` é por agência, e passkey é da pessoa;
- tela de login com "Entrar com passkey" e a gestão em Minha conta (frontend).
