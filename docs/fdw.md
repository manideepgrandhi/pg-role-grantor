# FDW setup reference

The **FDW setup** operation generates `postgres_fdw` configuration for the connected local database. The browser does not connect to either database. The local database server opens the remote connection when you execute `IMPORT FOREIGN SCHEMA` or query a foreign table.

## Connection fields

| Field                     | Meaning                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Local foreign-server name | Name of a new local `SERVER` object                                                 |
| Connected local database  | Database in which the script must run; checked by a preflight guard                 |
| Remote host               | One DNS hostname, IPv4 address, or unbracketed IPv6 address                         |
| Remote port               | Integer from 1 to 65535                                                             |
| Remote database           | Existing database reached by the foreign server                                     |
| Transport security        | `verify-full`, `require`, or explicit isolated-test `disable`                       |
| CA path                   | Optional `sslrootcert` file path on the local database server, not a browser upload |

`verify-full` is the default. Transport security and the optional CA path sit under the collapsed **TLS options** section. It requires certificate trust and a certificate matching the remote hostname. `require` encrypts traffic without guaranteeing hostname verification. `disable` provides no TLS protection and displays a danger warning.

The script enables `postgres_fdw` with `CREATE EXTENSION IF NOT EXISTS`. The extension installs the wrapper. The script does not create an arbitrary `FOREIGN DATA WRAPPER`, upgrade an extension, install packages, or change server authentication settings.

## Role mappings

Each mapping pairs an existing local execution role with an existing remote database user on one server. Multiple local roles can map to one remote user. A local role can appear only once per server setup. PUBLIC mappings are not supported.

The local role names are SQL identifiers. Remote user names, database connection options, and remote object-name options are SQL string values. The generator quotes these forms separately.

A NOLOGIN group mapping is not automatically available to its members. A member can inherit local server and table privileges but still fail with `user mapping not found`. `SET ROLE` to the mapped group changes the execution identity when allowed. Direct per-user mappings avoid that dependency. Views and SECURITY DEFINER routines can introduce another execution identity and require a separate review.

The site creates no remote login, remote grant, IAM role, or local membership as part of FDW setup. Every mapped local role must exist before the generated plan runs. A separate import role is recommended so application readers do not need schema CREATE.

## Credential placeholders

The site has no password field. Each mapping receives an unmistakable marker such as `__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__`. The marker appears in a plan-wide preflight check and in a guarded mapping block.

Markers accept only the UTF-8 hex encoding of the password, not raw password text. The generator never receives either value. Hex encoding prevents unknown password quotes, backslashes, or dollar-quote delimiters from breaking generated DO blocks after private editing. Hex is reversible and must be protected like the password itself.

The preflight guard precedes all mutations in the plan, including unrelated role creation. Unedited placeholders abort the script before any changes. Each mapping block also checks its own password variable. Editing only the preflight occurrence cannot store an unresolved mapping password. Any later failure aborts the transaction.

Every full marker must be replaced with the same even-length UTF-8 hex value in a private copy of the downloaded SQL. Empty, non-hex, unresolved, and invalid UTF-8 values are blocked. The generator decodes hex inside a guarded block and uses PostgreSQL `format` with `%L` to quote the actual password.

One way to compute the value offline is a private terminal prompt, not a command-line password argument:

```sh
python3 -c "import getpass; print(getpass.getpass('Remote password: ').encode('utf-8').hex())"
```

The output is a credential. Protect terminal scrollback and the edited SQL. Never enter either the raw password or its hex encoding into this site.

The finished SQL file and `CREATE USER MAPPING` statements contain credentials. Database catalogs, database logs, client history, and audit tooling have their own access and retention rules. The generator does not disable logging or alter audit controls. The [AWS FDW guide](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/postgresql-commondbatasks-fdw.html) specifically warns about passwords in statement logs.

## Table modes

### Import remote schema

The selection supports all eligible remote tables, `LIMIT TO`, or `EXCEPT`. A limit or exclusion needs at least one remote table name. An all-table import cannot include a name list.

The selected import execution role must have its own mapping in this operation. The executor must be allowed to `SET ROLE` to it. The script grants that role schema CREATE, imports as that role, grants table access, then restores the original execution role. Schema CREATE remains granted for later imports. Imported foreign tables belong to the import role.

Table grants cover only foreign tables on the new server in the selected local schema. They do not grant access to unrelated local tables. Import names and column metadata come from the remote server. Compatible custom types and collations must already exist locally. Remote defaults and generated expressions are not imported. Writer operations involving identity, defaults, or generated columns require a separate review.

A later remote table is not imported automatically. Import and local grants must be reviewed again. Existing default-privilege controls remain available under **Grants** → **Future objects**, but FDW setup does not create future remote objects or remote ACLs.

### Define one foreign table

The form accepts a local table, remote schema and table, and structured column rows. Each row contains a local column name, type, optional remote column alias, and optional NOT NULL flag.

Names must be unique. Type inputs accept concrete simple built-ins, simple custom types with optional schema qualification, and arrays. They do not accept SQL expressions, type modifiers, defaults, collations, or constraints. Import is preferable for complex definitions. Remote types, collations, names, and nullability must match the intended local definition.

One manual foreign table is generated per server setup. Bulk definitions use import. This form is not an editor for adding tables to an already configured server.

### Server and mappings only

This mode enables the extension, creates the server and mappings, and grants local database CONNECT and foreign-server USAGE. It creates no schema or foreign table. Separate table definitions and grants are needed before queries can run.

## Local grants

Every mapped role receives local CONNECT and foreign-server USAGE. Table modes add schema USAGE. Reader adds SELECT on the created foreign tables. Read-write adds SELECT, INSERT, UPDATE, and DELETE. It does not add TRUNCATE, ownership, or server administration. Only the designated importer receives schema CREATE.

## Remote prerequisites

These are a checklist, not generated remote-side SQL:

- The remote database user already exists with LOGIN and appropriate authentication.
- The remote user has CONNECT on the remote database, USAGE on its schema, and SELECT on the target tables.
- Writers also have remote INSERT, UPDATE, and DELETE. Remote defaults can require sequence privileges.
- DNS, routes, security groups, firewalls, remote authentication rules, and TLS trust allow the local database server to connect.

Local grants never confer remote privileges. The script does not set `password_required=false`, disable RLS, or bypass remote authorization.

## Collisions and transaction behavior

One setup per server name is allowed in a plan. Existing servers cause a preflight error. Mapping and foreign-table creation do not skip existing definitions. There is no silent reuse, overwrite, drop, or credential rotation.

PostgreSQL supports `CREATE USER MAPPING IF NOT EXISTS`, but the generator deliberately does not use it. Skipping an existing mapping would not prove that its credentials or remote identity match the intended configuration.

An existing local schema is reused without changing its owner. Missing grant or CREATE authority still causes an error. A collision during table creation or import rolls back the new server, mappings, and other changes in the same transaction. The script does not make an existing server setup idempotent by ignoring conflicts.

## Aurora restrictions

AWS documents `postgres_fdw` for Aurora PostgreSQL. Extension availability, permitted extension lists, administrative authority, network paths, and TLS trust depend on the actual engine release and cluster configuration. `rds_superuser` is not a true PostgreSQL superuser. Managed filesystems and parameter groups are not administered by this site.

The generator does not claim Aurora runtime verification. The native tests use a fresh PostgreSQL 17.5 cluster with two local databases and loopback SCRAM authentication. TLS configuration is generated and validated structurally, not tested against a live certificate chain.

## Official references

- [PostgreSQL 14 postgres_fdw](https://www.postgresql.org/docs/14/postgres-fdw.html)
- [PostgreSQL 17 postgres_fdw](https://www.postgresql.org/docs/17/postgres-fdw.html)
- [CREATE USER MAPPING](https://www.postgresql.org/docs/17/sql-createusermapping.html)
- [libpq TLS verification](https://www.postgresql.org/docs/17/libpq-ssl.html)
- [Aurora postgres_fdw setup](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/postgresql-commondbatasks-fdw.html)
- [Aurora rds_superuser boundaries](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
