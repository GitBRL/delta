# ADR 0003 — Ambiente de desenvolvimento só local, em containers

**Status:** aceita · 12/11/2026

## Contexto

O projeto não deve ser publicado no GitHub. A máquina de desenvolvimento não tem PHP; tem Docker, mas sem o plugin `docker compose` (o `docker-compose` v1 do sistema está quebrado). Outros projetos já ocupam portas comuns, e há pouca memória livre.

## Decisão

- Sem repositório git por enquanto (decisão do usuário) e nada no GitHub; a verificação completa é `make ci`.
- PHP 8.5 + FrankenPHP + Composer na imagem `delta-php:dev` (`infra/docker/php/Dockerfile`), rodando como o UID do usuário do host.
- `bin/compose` usa `docker compose` se existir; senão roda o Compose dentro da imagem `docker:cli`, que já está na máquina.
- Portas só em `127.0.0.1`:

  | Serviço | Porta |
  |---|---|
  | API | 8000 |
  | Angular | 4300 (a 4200 é usada por outro projeto da máquina) |
  | Postgres | 55432 |
  | Valkey | 56379 |
  | Mailpit | 58025 |

- Segredos locais gerados aleatoriamente em `.env` na raiz (`bin/setup-env`), injetados nos containers. `backend/.env` não guarda senhas.
- Em dev, a API roda em modo clássico do FrankenPHP (recarrega o código a cada request). Octane em modo worker fica para homologação e produção, com os listeners de limpeza de contexto já configurados.
- Builds do Angular com `NODE_OPTIONS=--max-old-space-size=1536`.
