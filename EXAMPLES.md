# Example plans

Every name in this file and the generated examples is a placeholder. Existing databases, schemas, creator roles, and member users must be supplied by you. The site never creates a connection or executes these scripts.

## Give one user read and write in one script

In **Access setup**, select **Read + write** and enter:

| Field                    | Example value    |
| ------------------------ | ---------------- |
| Group role               | `example_writer` |
| Target database          | `example_db`     |
| Schemas                  | `example_schema` |
| Future object creators   | `example_owner`  |
| Assign to existing users | `app`            |

Here `app` is an example existing login, not an account created by the generator. Add the setup and download the script. The script creates `example_writer` if missing, grants SELECT, INSERT, UPDATE, DELETE and sequence USAGE, sets defaults for objects created by `example_owner`, and assigns the group to `app`.

The generated PostgreSQL 17 [writer setup](examples/writer.sql) is standalone. No `role_manager.provision` installation is needed.

## Give access to one routine overload

In **Object grants**, select **Function**, name `example_schema.lookup`, and enter one input type per line:

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

In **Defaults**, choose **All routine kinds**. Set creator `example_owner`, leave schema scope blank, target PUBLIC, choose REVOKE, and select EXECUTE.

The generated statement is global within the current database:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE "example_owner"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC RESTRICT;
```

Add a second default operation that grants EXECUTE to `example_executor` in `example_schema`. This affects new functions and procedures created as `example_owner`. Existing routines need a separate object REVOKE. Removing PUBLIC execution may break callers that rely on it.

## Grant a subset of columns

In **Object grants**, select **Table columns**. Name `example_schema.contacts`, enter columns `display_name,email`, and select SELECT. Add a separate UPDATE operation if the column set differs.

```sql
GRANT SELECT ("display_name", "email") ON TABLE "example_schema"."contacts" TO "example_app";
```

Column grants do not limit a user who already has table-level SELECT through any route.

## Remove delegation but keep access

Select REVOKE for the intended object grant. Expand **Delegation & revoke options** and select **Revoke grant option only**. RESTRICT fails when dependent grants exist. CASCADE also removes dependent grants in that grant chain.

```sql
REVOKE GRANT OPTION FOR SELECT ON TABLE "example_schema"."contacts" FROM "example_app" RESTRICT;
```

## Add a PostgreSQL monitoring role

In **Membership**, select `pg_monitor` in the predefined-role list. Enter the intended existing member, then review the cluster-wide scope warning. These built-in roles are not the same as scoped reader/writer templates.

AWS-managed roles are intentionally not offered. Aurora restrictions and the actual engine release determine what an administrator can grant.

## Set up FDW with explicit role mappings

Choose **FDW setup** and replace the example connection names. Keep **verify-full** unless your reviewed environment requires another mode.

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
