#!/bin/bash
# Tạo role và database khi volume Postgres còn trống (SPEC §3.1). Role là cấp cluster nên KHÔNG
# tạo trong migration. Mật khẩu đọc từ biến môi trường, không nằm trong repo.
#   cu_owner: chạy migration, sở hữu bảng và purge_student() (CREATEDB cho shadow DB của migrate dev)
#   cu_app:   app + worker, chỉ SELECT/INSERT trên bảng append-only (grant nằm trong migration)
set -euo pipefail

: "${CU_OWNER_PASSWORD:?CU_OWNER_PASSWORD chưa đặt}"
: "${CU_APP_PASSWORD:?CU_APP_PASSWORD chưa đặt}"
DATABASES="${CU_DATABASES:-cu cu_test cu_eval}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$CU_OWNER_PASSWORD" -v app_pw="$CU_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE cu_owner LOGIN CREATEDB PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cu_owner') \gexec
SELECT format('CREATE ROLE cu_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cu_app') \gexec
SQL

for db in $DATABASES; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v db="$db" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER cu_owner', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -v db="$db" <<'SQL'
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO cu_app', :'db') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO cu_owner;
SQL
done
