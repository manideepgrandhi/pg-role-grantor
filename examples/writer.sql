-- PG role grantor | PostgreSQL 17
-- Generated locally. Review permissions, target database, and execution output.
-- No connection, credentials, or execution is performed by this app.
-- Review before running. This app does not connect to a database or verify your grant authority. PostgreSQL can warn and apply only a subset of requested grants; inspect execution output and resulting ACLs.
-- Roles and memberships are cluster-wide. Object grants and default privileges apply in the connected database. Run each database-specific script in the correct database.
-- Access is additive through direct grants, membership, PUBLIC, ownership, and security-definer routines. Reader does not guarantee read-only access. RLS remains unchanged.
-- TABLE syntax also covers views and foreign tables. Actual operations depend on the relation kind, view rules, and foreign server support.
-- Defaults affect only future objects created by the listed creator roles in this database. Membership does not inherit creator defaults; use SET ROLE during deployment or configure every actual creator.
-- Memberships apply across the cluster. Existing indirect memberships and grantors can preserve access after a revoke.
-- The setup refuses LOGIN or elevated existing group roles. It adds permissions without clearing existing ACLs, ownership, memberships, or default privileges. Creator and member roles must already exist. No passwords or login roles are created.

BEGIN;

DO $grantor$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_writer') THEN
    CREATE ROLE "example_writer" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  ELSIF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_writer' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolinherit)) THEN
    RAISE EXCEPTION 'Existing group role has incompatible attributes';
  END IF;
END;
$grantor$;

DO $grantor$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_owner') THEN
    RAISE EXCEPTION 'Required role does not exist';
  END IF;
END;
$grantor$;

DO $grantor$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'app') THEN
    RAISE EXCEPTION 'Required role does not exist';
  END IF;
END;
$grantor$;

GRANT CONNECT ON DATABASE "example_db" TO "example_writer";

GRANT USAGE ON SCHEMA "example_schema" TO "example_writer";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "example_schema" TO "example_writer";

ALTER DEFAULT PRIVILEGES FOR ROLE "example_owner" IN SCHEMA "example_schema"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "example_writer";

GRANT USAGE ON ALL SEQUENCES IN SCHEMA "example_schema" TO "example_writer";

ALTER DEFAULT PRIVILEGES FOR ROLE "example_owner" IN SCHEMA "example_schema"
  GRANT USAGE ON SEQUENCES TO "example_writer";

GRANT "example_writer" TO "app" WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;

COMMIT;
