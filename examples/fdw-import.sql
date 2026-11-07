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
-- IMPORT connects to the remote database when you execute the SQL. The selected mapped import role needs local schema CREATE and server USAGE and the script executor must be allowed to SET ROLE to it. Imported tables are owned by that role. CREATE is granted to the importer and retained for later imports. The block restores the original execution role. Only foreign tables on the newly created server in this schema receive the generated table grants.
-- IMPORT reads remote definitions. Compatible custom types and collations must already exist locally. Remote defaults and generated expressions are not imported. LIMIT TO / EXCEPT uses remote table names. New remote tables need another reviewed import and local grants; this setup does not create future remote tables or default ACLs.

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
  credential_hex := E'__REPLACE_FDW_1_MAPPING_2_PASSWORD_HEX__';
  IF credential_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW password placeholder is unresolved or invalid hex. Replace every full marker with UTF-8 password hex in your private SQL file';
  END IF;
  PERFORM convert_from(decode(credential_hex, 'hex'), 'UTF8');
  IF EXISTS (SELECT FROM pg_catalog.pg_foreign_server WHERE srvname = E'example_server') THEN
    RAISE EXCEPTION 'FDW server already exists. Existing configuration is not overwritten';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_app') THEN
    RAISE EXCEPTION 'An FDW mapped local role does not exist';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = E'example_importer') THEN
    RAISE EXCEPTION 'An FDW mapped local role does not exist';
  END IF;
END;
$fdw_preflight$;

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

CREATE SERVER "example_server"
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
    E'example_app', E'example_server', E'example_remote_reader', mapping_password);
END;
$fdw_mapping$;

DO $fdw_mapping$
DECLARE
  mapping_password_hex text := E'__REPLACE_FDW_1_MAPPING_2_PASSWORD_HEX__';
  mapping_password text;
BEGIN
  IF mapping_password_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW mapping password placeholder is unresolved or invalid hex';
  END IF;
  mapping_password := convert_from(decode(mapping_password_hex, 'hex'), 'UTF8');
  EXECUTE format('CREATE USER MAPPING FOR %I SERVER %I OPTIONS (user %L, password %L)',
    E'example_importer', E'example_server', E'example_remote_reader', mapping_password);
END;
$fdw_mapping$;

GRANT CONNECT ON DATABASE "example_db" TO "example_app", "example_importer";

GRANT USAGE ON FOREIGN SERVER "example_server" TO "example_app", "example_importer";

CREATE SCHEMA IF NOT EXISTS "example_foreign";

GRANT USAGE ON SCHEMA "example_foreign" TO "example_app", "example_importer";

GRANT CREATE ON SCHEMA "example_foreign" TO "example_importer";

DO $fdw_import$
DECLARE
  original_role name := current_user;
  foreign_relation record;
BEGIN
  EXECUTE E'SET LOCAL ROLE "example_importer"';
  EXECUTE E'IMPORT FOREIGN SCHEMA "example_remote" LIMIT TO ("example_items")
  FROM SERVER "example_server" INTO "example_foreign"
  OPTIONS (import_default ''false'', import_generated ''false'');';
  FOR foreign_relation IN
    SELECT n.nspname, c.relname FROM pg_catalog.pg_foreign_table f
    JOIN pg_catalog.pg_class c ON c.oid = f.ftrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_foreign_server s ON s.oid = f.ftserver
    WHERE s.srvname = E'example_server' AND n.nspname = E'example_foreign'
  LOOP
    EXECUTE format(E'GRANT SELECT ON TABLE %I.%I TO "example_app", "example_importer"', foreign_relation.nspname, foreign_relation.relname);
  END LOOP;
  EXECUTE format('SET LOCAL ROLE %I', original_role);
END;
$fdw_import$;

COMMIT;
