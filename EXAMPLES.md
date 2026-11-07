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
