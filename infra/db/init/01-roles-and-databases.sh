#!/usr/bin/env bash
# Executado pelo entrypoint do Postgres só na PRIMEIRA inicialização do volume.
# Cria as roles com privilégio mínimo e os bancos delta (dev) e delta_test (testes).
#
#  delta_owner    dono das tabelas; roda migrations; BYPASSRLS (backfills e funções SECURITY DEFINER)
#  delta_app      runtime da API e dos workers; NOBYPASSRLS; sem DDL
#  delta_admin    backoffice/suporte; BYPASSRLS; uso auditado
#  delta_readonly BI interno; só leitura; sujeito a RLS
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    CREATE ROLE delta_owner    LOGIN BYPASSRLS   PASSWORD '${DELTA_OWNER_PASSWORD}';
    CREATE ROLE delta_app      LOGIN NOBYPASSRLS PASSWORD '${DELTA_APP_PASSWORD}';
    CREATE ROLE delta_admin    LOGIN BYPASSRLS   PASSWORD '${DELTA_ADMIN_PASSWORD}';
    CREATE ROLE delta_readonly LOGIN NOBYPASSRLS PASSWORD '${DELTA_READONLY_PASSWORD}';
EOSQL

for db in delta delta_test; do
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
         -c "CREATE DATABASE ${db} OWNER delta_owner"

    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
        REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
        GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO delta_app, delta_admin, delta_readonly;

        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO delta_app, delta_admin, delta_readonly;

        -- Tudo que o delta_owner criar já nasce com o privilégio certo para cada role.
        ALTER DEFAULT PRIVILEGES FOR ROLE delta_owner IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO delta_app, delta_admin;
        ALTER DEFAULT PRIVILEGES FOR ROLE delta_owner IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO delta_app, delta_admin;
        ALTER DEFAULT PRIVILEGES FOR ROLE delta_owner IN SCHEMA public
            GRANT SELECT ON TABLES TO delta_readonly;

        -- Funções não são executáveis por PUBLIC; cada migration concede explicitamente.
        ALTER DEFAULT PRIVILEGES FOR ROLE delta_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
EOSQL
done
