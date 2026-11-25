#!/bin/bash
# Executado apenas na PRIMEIRA inicialização do volume do PostgreSQL.
# Cria os bancos auxiliares (testes e shadow) e habilita as extensões em todos.
set -euo pipefail

for db in "${POSTGRES_DB}_test" "${POSTGRES_DB}_shadow"; do
  echo "[alertacidade] criando banco ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE \"${db}\" OWNER \"${POSTGRES_USER}\";"
done

for db in "$POSTGRES_DB" "${POSTGRES_DB}_test" "${POSTGRES_DB}_shadow"; do
  echo "[alertacidade] habilitando extensões em ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    ALTER DATABASE "${db}" SET timezone TO 'UTC';
EOSQL
done
