# Delta — comandos do ambiente local. Tudo roda em containers: não é preciso PHP no host.
# Uso: make <alvo>   (make help lista os alvos)

SHELL        := /bin/bash
COMPOSE      := ./bin/compose
PHP          := $(COMPOSE) run --rm -T api
NODE_OPTIONS ?= --max-old-space-size=1536
export NODE_OPTIONS

.DEFAULT_GOAL := help
.PHONY: help setup up dev dev-stop demo restart-workers down logs ps migrate fresh test fmt lint stan audit ci \
        artisan composer psql front front-test front-lint front-build

help: ## Lista os comandos
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

## ---------- Ambiente ----------

setup: ## Primeira vez: segredos locais, imagem PHP, dependências e banco
	./bin/setup-env
	$(COMPOSE) build api
	$(COMPOSE) up -d postgres valkey mailpit
	@[ -f backend/.env ] || cp backend/.env.example backend/.env
	$(PHP) composer install --no-interaction
	@grep -q '^APP_KEY=base64:' backend/.env || $(PHP) php artisan key:generate --no-interaction
	$(MAKE) migrate
	cd frontend && npm ci

up: ## Sobe Postgres, Valkey, Mailpit, API (http://localhost:8000), Horizon e scheduler
	$(COMPOSE) up -d postgres valkey mailpit gotenberg api horizon scheduler

dev: ## Tudo no ar para usar: containers, migrations e Angular em 2º plano (http://localhost:4300)
	$(MAKE) up
	$(MAKE) migrate
	@./bin/front-bg start

dev-stop: ## Para o Angular em 2º plano (os containers seguem no ar; use make down)
	@./bin/front-bg stop

demo: ## Agência de demonstração com dados, relatórios e envio automático (só local)
	$(PHP) php artisan delta:demo

restart-workers: ## Reinicia Horizon e scheduler (necessário após mudar código de jobs)
	$(COMPOSE) restart horizon scheduler

down: ## Para todos os containers (os dados ficam nos volumes)
	$(COMPOSE) down

logs: ## Acompanha os logs da API
	$(COMPOSE) logs -f --tail=100 api

ps: ## Estado dos containers
	$(COMPOSE) ps

## ---------- Banco ----------

migrate: ## Roda migrations com a role dona (delta_owner)
	$(PHP) php artisan migrate --database=pgsql_owner --no-interaction

fresh: ## APAGA o banco de dev e recria do zero
	$(PHP) php artisan migrate:fresh --database=pgsql_owner --no-interaction

psql: ## psql como delta_app (a mesma role da aplicação, sujeita a RLS)
	@set -a && . ./.env && set +a && \
	  $(COMPOSE) exec -e PGPASSWORD="$$DELTA_APP_PASSWORD" postgres psql -h 127.0.0.1 -U delta_app -d delta

## ---------- Backend ----------

test: ## Testes do backend (Pest, Postgres real no banco delta_test)
	$(PHP) php artisan test

fmt: ## Formata o PHP (Pint)
	$(PHP) ./vendor/bin/pint

stan: ## Análise estática (PHPStan/Larastan, nível máximo)
	$(PHP) ./vendor/bin/phpstan analyse --memory-limit=512M --no-progress

lint: ## Estilo + análise estática do backend
	$(PHP) ./vendor/bin/pint --test
	$(MAKE) stan

artisan: ## Executa artisan: make artisan c="route:list"
	$(PHP) php artisan $(c)

composer: ## Executa composer: make composer c="require vendor/pacote"
	$(PHP) composer $(c)

## ---------- Frontend ----------

front: ## Dev server do Angular (http://localhost:4300, proxy para a API)
	cd frontend && npm start

front-test: ## Testes do frontend (app + design system)
	cd frontend && npm test

front-lint: ## ESLint do frontend
	cd frontend && npm run lint

front-build: ## Build de produção do frontend
	cd frontend && npm run build

cli-test: ## Testes da CLI delta (Node, sem dependências)
	cd cli && npm test

site: ## Site de marketing em http://localhost:4400 (estático)
	python3 -m http.server 4400 --directory site

site-build: ## Gera o site de marketing a partir de site/gerar.py
	python3 site/gerar.py

site-test: ## Testes do site (calculadoras, metadados, links, sitemap)
	node --test site/test/*.test.mjs

## ---------- Qualidade ----------

audit: ## Vulnerabilidades conhecidas nas dependências (precisa de rede)
	$(PHP) composer audit
	cd frontend && npm audit --omit=dev

ci: ## Tudo que bloqueia uma mudança, rodando localmente
	$(MAKE) lint
	$(MAKE) test
	$(MAKE) front-lint
	$(MAKE) front-test
	$(MAKE) front-build
	$(MAKE) cli-test
	$(MAKE) site-test
	@echo "✔ CI local verde"
