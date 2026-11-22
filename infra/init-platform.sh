#!/bin/bash
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$BRAIN_APP_PASSWORD" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE brain_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE optimizer_brain TO brain_app;
GRANT USAGE ON SCHEMA public TO brain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE brain_migrator IN SCHEMA public GRANT SELECT ON TABLES TO brain_app;
SQL
