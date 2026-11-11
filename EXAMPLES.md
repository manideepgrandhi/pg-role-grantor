# Example plans

Every name in this file and the generated examples is a placeholder. Existing databases, schemas, creator roles, and member users must be supplied by you. The site never creates a connection or executes these scripts.

## Give one user read and write in one script

In **Access setup**, select **Read + write** and enter:

| Field                   | Example value    |
| ----------------------- | ---------------- |
| Group role              | `example_writer` |
| Target database         | `example_db`     |
| Schemas                 | `example_schema` |
| Future object creators  | `example_owner`  |
| Assign to users / roles | `app`            |

Creators and users are optional and start blank. Here `app` is an example existing login, not an account created by the generator. Add the setup and download the script. The script creates `example_writer` if missing and grants, on existing objects and as defaults for objects created by `example_owner`:

- SELECT, INSERT, UPDATE, DELETE, TRUNCATE on tables
- SELECT, USAGE on sequences
- EXECUTE on functions
- USAGE on future types (defaults only)

It then assigns the group to `app`. **Reader** grants the same without INSERT, UPDATE, DELETE, and TRUNCATE.

The generated PostgreSQL 17 [writer setup](examples/writer.sql) is standalone. No `role_manager.provision` installation is needed.

## Leave creators blank

If the role that runs the script also creates the objects, leave **Future object creators** blank. The defaults omit `FOR ROLE`:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA "example_schema"
  GRANT SELECT ON TABLES TO "example_reader";
```

They apply only to objects later created by that executing role, not by other owners. Verification SQL inspects `CURRENT_USER`, so run it as the same role.

## Grant tables and sequences in one step

In **Operation**, choose **Grants** and keep **Existing objects**. Check **Table / view / foreign table** and **Sequence**, choose **All existing objects in schemas**, and check SELECT and USAGE. One **Add to script** generates:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA "example_schema" TO "example_app";
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA "example_schema" TO "example_app";
```

USAGE is skipped for tables because tables do not support it. Switch the toggle to **Future objects** to do the same for objects created later.

## Give access to one routine overload

In **Grants**, keep **Existing objects**, check only **Function** (under **More**), name `example_schema.lookup`, and enter one input type per line:

```text
integer
text[]
```

Select EXECUTE, set the recipient to `example_app`, and add the operation. It generates:

```sql
GRANT EXECUTE ON FUNCTION "example_schema"."lookup"(integer, text[]) TO "example_app";
```

A named routine requires exact input types. This grant does not revoke PUBLIC EXECUTE or change a function's security mode.

## Restrict future routine execution

In **Grants**, switch to **Future objects** and check only **All routine kinds**. Set creator `example_owner`, leave schema scope blank, target PUBLIC, choose REVOKE, and select EXECUTE.

The generated statement is global within the current database:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE "example_owner"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC RESTRICT;
```

Add a second default operation that grants EXECUTE to `example_executor` in `example_schema`. This affects new functions and procedures created as `example_owner`. Existing routines need a separate object REVOKE. Removing PUBLIC execution may break callers that rely on it.

## Grant a subset of columns

In **Grants**, check **Table columns** under **More**. Name `example_schema.contacts`, enter columns `display_name,email`, and select SELECT. Add a separate UPDATE operation if the column set differs.

```sql
GRANT SELECT ("display_name", "email") ON TABLE "example_schema"."contacts" TO "example_app";
```

Column grants do not limit a user who already has table-level SELECT through any route.

## Remove delegation but keep access

Select REVOKE for the intended object grant. Expand **Delegation & revoke options** and select **Revoke grant option only**. RESTRICT fails when dependent grants exist. CASCADE also removes dependent grants in that grant chain.

```sql
REVOKE GRANT OPTION FOR SELECT ON TABLE "example_schema"."contacts" FROM "example_app" RESTRICT;
```

## Create a login role

In **Create role**, enter the role name and check **WITH LOGIN**. A 16-character random password fills the visible **Password** field. Select **Regenerate** for another or type your own. Leave **WITH LOGIN** unchecked for a NOLOGIN group. The setup script contains:

```sql
CREATE ROLE "example_app" LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
```

The real script has your password as an escaped string where `'...'` is shown. Treat the downloaded file as a secret: statement logs, client history, and the file itself can expose the password. A rerun leaves an existing compatible LOGIN role, and its password, unchanged. An existing NOLOGIN or elevated role is rejected. Use **Membership** to grant groups to the new login. The plan and verification SQL only say that a password was set.

## Add a PostgreSQL monitoring role

In **Membership**, expand **Predefined PostgreSQL roles** and check `pg_monitor`. Enter the intended existing member, then review the cluster-wide scope warning. These built-in roles are not the same as scoped reader/writer templates.

AWS-managed roles are intentionally not offered. Aurora restrictions and the actual engine release determine what an administrator can grant.

## Set up FDW with explicit role mappings

Choose **FDW setup** and replace the example connection names. Keep **verify-full** under **TLS options** unless your reviewed environment requires another mode.

Add a mapping for each local execution role:

| Local role         | Remote user             |
| ------------------ | ----------------------- |
| `example_app`      | `example_remote_reader` |
| `example_importer` | `example_remote_reader` |

These are existing roles on their respective databases. They do not imply a group membership or an IAM role. Select `example_importer` as the import role. It receives local schema CREATE and owns the imported foreign tables. The application role receives local server USAGE, schema USAGE, and table SELECT, without needing the importer's user mapping.

Select **Import remote schema**, choose **LIMIT TO**, and enter `example_items`. Add the operation and download SQL. The [generated FDW import example](examples/fdw-import.sql) includes a separate marker for each mapping.

Before running, replace every full credential marker in your private SQL file, including the preflight occurrence. Use only the UTF-8 hex encoding of each remote password, not raw password text. Hex is reversible, not encryption. Do not enter passwords into this site. Unmodified scripts fail before any mutation. Guarded mapping blocks also prevent a partially edited script from storing an unresolved password marker.

Configure the remote users' CONNECT, schema USAGE, and table SELECT separately. Local grants do not grant remote access. For read-write access, both local and remote users need the matching write permissions.

## Define a foreign table with a remote column alias

In **FDW setup**, select **Define one foreign table**. Enter local table `example_items` and remote schema and table `example_remote.example_items` using their separate fields.

Add these structured columns:

| Local column  | Type      | Remote column        |
| ------------- | --------- | -------------------- |
| `id`          | `integer` | blank, meaning `id`  |
| `description` | `text`    | `remote_description` |

The generated [manual FDW example](examples/fdw-manual.sql) quotes the remote column as an option string. It does not accept a raw `CREATE FOREIGN TABLE` fragment. Its types must match your real remote columns.

Existing server and mapping definitions are not overwritten. Choose reviewed new object names or manage existing configuration separately. See the [FDW reference](docs/fdw.md) for role identity, TLS, credentials, collision behavior, and Aurora restrictions.

## Review a writer plan before downloading

1. Add the writer setup above to the script plan.
2. Expand its item under **Script plan**.
3. Check the group name, database CONNECT, schema USAGE, table SELECT/INSERT/UPDATE/DELETE/TRUNCATE, sequence SELECT/USAGE, function EXECUTE, and future type USAGE.
4. Check the future-object creators and the existing member role. On PostgreSQL 16–17, writer setup requests ADMIN false, INHERIT true, and SET false.
5. Select **Download .sql** to save the reviewed script.

Only queued operations appear in the summary. Edits still in a form do not change an already queued request. Remove an operation and add its replacement when needed.

## Inspect permissions after setup

1. Keep the same plan after downloading setup SQL.
2. Run the reviewed setup yourself in the intended database.
3. Expand **Verification SQL** under the preview and download `permission-verification.sql`.
4. Run that SELECT-only script in the same database, with the same search path and matching major version.
5. Compare each requested operation with its JSON evidence.

For the writer group, inspect direct table ACLs and sequence SELECT and USAGE. For the member application role, inspect the membership row and inherited role usage. For each creator, inspect the default-ACL scope and privileges. A configured default does not prove that a future deployment uses that creator role.

After a grant-option-only revoke, inspect `explicit_acl_grant_option` separately from `explicit_acl_privilege`. Effective access can remain true through another grant path. A per-schema default REVOKE can leave `global_or_builtin_privilege` true because global defaults are additive.

For FDW, inspect mapping presence and the local foreign-table inventory. Verification never queries remote data or mapping credentials. Mapping presence does not prove that the remote user, password, TLS, column mapping, or remote permissions are correct. The inventory cannot prove that every eligible remote table was imported.

Missing resources produce missing-status evidence rather than a PASS. Large objects report explicit ACLs without an effective-access calculation. See the [verification limits](README.md#review-requests-and-inspect-the-result) before interpreting results.
