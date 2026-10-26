-- 001: initial schema. Apply with: psql "$DATABASE_URL" -f database/migrations/001_initial_schema.sql
BEGIN;
\i database/schema.sql
INSERT INTO schema_migrations(version) VALUES ('001_initial_schema');
COMMIT;
