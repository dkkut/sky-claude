-- Роль БД для работающего приложения: без суперпользователя, создания баз/ролей и изменения схемы.
-- Выполняется владельцем (psql -v app_password=… -v owner=sky -v dbname=sky -f scripts/db-roles.sql). Идемпотентно.
--
-- Что получает sky_app: CONNECT, USAGE на схему public, SELECT/INSERT/UPDATE/DELETE на все таблицы,
-- USAGE/SELECT на последовательности (и то же — на таблицы и последовательности, созданные позже владельцем).
-- Чего НЕ получает: CREATE на схему, TRUNCATE, REFERENCES, TRIGGER, DDL, чтение файлов сервера БД, COPY … PROGRAM.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE sky_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sky_app') \gexec
-- пароль можно сменить повторным запуском с новым значением
SELECT format('ALTER ROLE sky_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_password') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO sky_app', :'dbname') \gexec
GRANT USAGE ON SCHEMA public TO sky_app;
REVOKE CREATE ON SCHEMA public FROM sky_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sky_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sky_app;
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sky_app', :'owner') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sky_app', :'owner') \gexec
-- Служебное: у приложения не должно быть доступа к чужим базам кластера.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', d.datname) FROM pg_database d WHERE d.datname NOT IN ('template0','template1', :'dbname') AND has_database_privilege('public', d.datname, 'CONNECT') \gexec
