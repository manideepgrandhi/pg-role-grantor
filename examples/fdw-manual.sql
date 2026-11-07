-- PG role grantor | PostgreSQL 17
-- Generated locally. Review permissions, target database, and execution output.
-- No connection, credentials, or execution is performed by this app.
-- Review before running. This app does not connect to a database or verify your grant authority. PostgreSQL can warn and apply only a subset of requested grants; inspect execution output and resulting ACLs.
-- Roles and memberships are cluster-wide. Object grants and default privileges apply in the connected database. Run each database-specific script in the correct database.
-- Access is additive through direct grants, membership, PUBLIC, ownership, and security-definer routines. Reader does not guarantee read-only access. RLS remains unchanged.
-- FDW credentials are placeholders only. BEFORE running, replace every full __REPLACE_FDW_*_PASSWORD_HEX__ token in a private SQL file, including its guard occurrence, with the UTF-8 hex encoding of that remote password (hex digits only, not a raw password). The guard aborts the entire plan before mutations until every token is replaced. Never paste credentials into this site. Hex is reversible, not encryption. Protect the finished file and database/client/audit logs; mapping DDL can expose secrets.
-- FDW mapping is local execution role → existing remote database user, not an IAM role or local membership grant. A member does not inherit a NOLOGIN group user mapping. Direct queries use the current execution identity; SET ROLE changes it. Views and SECURITY DEFINER routines may use another identity. Prefer explicit per-user mappings.
-- Remote-side checklist (not executed): create/allow the remote LOGIN, allow CONNECT on the remote database, USAGE on its schema, and SELECT on remote tables. Writers also need remote INSERT, UPDATE, DELETE and sequence privileges where remote defaults require them. Local GRANTs never create remote authority.
-- Network access originates at the local database server, not this browser. Configure DNS, routing, security groups/firewalls, remote authentication, and TLS there. Non-superuser postgres_fdw connections must use supported authentication; this script never sets password_required=false.
-- FDW setup requires extension-install authority (normally superuser or an allowed managed-service administrator), server-creation authority, user-mapping authority, and local schema/grant authority. It does not grant those administrative powers to application users.
-- FDW reruns intentionally fail on an existing server, mapping, or foreign table. No existing server or mapping is silently reused or overwritten. CREATE EXTENSION IF NOT EXISTS does not upgrade an installed extension. An existing local schema is reused without changing its owner.
-- verify-full checks encryption, certificate trust, and hostname. The database server needs a trusted remote CA and a certificate matching the hostname. An optional sslrootcert path refers to a file on that database server, not this computer. Confirm supported trust-store configuration on Aurora.
-- Manual foreign-table types, nullability, column names, and collations must match the remote table. This form supports simple concrete types and arrays, not typmods, collations, defaults, constraints, or raw SQL. Prefer IMPORT for complex definitions.

BEGIN;

DO $fdw_preflight$
DECLARE
  credential_hex text;
BEGIN
  IF current_database() <> E'example_db' THEN
    RAISE EXCEPTION 'FDW script is connected to the wrong local database';
  END IF;
  credential_hex := E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__';
  IF credential_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW password placeholder is unresolved or invalid hex. Replace every full marker with UTF-8 password hex in your private SQL file';
  END IF;
  PERFORM convert_from(decode(credential_hex, 'hex'), 'UTF8');
  IF EXISTS (SELECT FROM pg_catalog.pg_foreign_server WHERE srvname = E'example_manual_server') THEN
    RAISE EXCEPTION 'FDW server already exists. Existing configuration is not overwritten';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_app') THEN
    RAISE EXCEPTION 'An FDW mapped local role does not exist';
  END IF;
END;
$fdw_preflight$;

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER "example_manual_server"
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host E'remote.example.invalid', port E'5432', dbname E'example_remote_db',
    sslmode E'verify-full', connect_timeout '10');

DO $fdw_mapping$
DECLARE
  mapping_password_hex text := E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__';
  mapping_password text;
BEGIN
  IF mapping_password_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW mapping password placeholder is unresolved or invalid hex';
  END IF;
  mapping_password := convert_from(decode(mapping_password_hex, 'hex'), 'UTF8');
  EXECUTE format('CREATE USER MAPPING FOR %I SERVER %I OPTIONS (user %L, password %L)',
    E'example_app', E'example_manual_server', E'example_remote_reader', mapping_password);
END;
$fdw_mapping$;

GRANT CONNECT ON DATABASE "example_db" TO "example_app";

GRANT USAGE ON FOREIGN SERVER "example_manual_server" TO "example_app";

CREATE SCHEMA IF NOT EXISTS "example_foreign";

GRANT USAGE ON SCHEMA "example_foreign" TO "example_app";

CREATE FOREIGN TABLE "example_foreign"."example_items" (
  "id" integer,
  "description" text OPTIONS (column_name E'remote_description')
) SERVER "example_manual_server"
  OPTIONS (schema_name E'example_remote', table_name E'example_items');

GRANT SELECT ON TABLE "example_foreign"."example_items" TO "example_app";

COMMIT;
