# PG role grantor

A browser-only SQL generator for PostgreSQL and Aurora PostgreSQL. Build a role and privilege plan, inspect the SQL, then copy or download one standalone script.

No database connections, secrets, login screens, execution, analytics, external fonts, or runtime package dependencies. Form values and plans stay in memory. Reloading clears them. A service worker caches application files for offline use after the first successful visit.

## Run locally

Use Python 3 to serve the files:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080`. ES modules need HTTP, so opening `index.html` directly with `file://` is not supported. Clipboard access and service workers require HTTPS or localhost.

## Build a script

1. Select PostgreSQL or Aurora PostgreSQL and a supported major version.
2. Choose **Access setup** for a reader, read-write, or routine-executor group. Replace every `example_` value with your own name.
3. Enter the database, schemas, actual future-object creators, and existing user roles that receive membership.
4. Select **Add to script**.
5. Add individual object grants, default privileges, memberships, or another group as needed. Remove an operation to replace it.
6. Read **Before you run this** and inspect the generated SQL.
7. Select **Copy SQL** or **Download .sql**. Run the script yourself in the intended database using an account with the required authority.

The app does not discover objects or verify names, creator roles, ownership, or grant authority. PostgreSQL can issue warnings and grant only a subset of the requested privileges. Inspect server output and resulting ACLs, even after a successful transaction.

Changing the platform or major version revalidates the entire plan. Export is disabled if any operation becomes incompatible. Form drafts reset on a tab or target change; operations already added to the plan remain until removed or the page reloads.

## Coverage

The catalog supports upstream PostgreSQL majors **14, 15, 16, and 17**. It does not claim support for 18 or later. Aurora mode uses the selected upstream major's SQL grammar and displays managed-service restrictions. It does not certify every Aurora engine minor release or regional availability.

| Object level | Grantable permissions |
| --- | --- |
| Database | CONNECT, CREATE, TEMPORARY |
| Schema | USAGE, CREATE |
| Table, view, foreign table | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; MAINTAIN on 17 |
| Column | SELECT, INSERT, UPDATE, REFERENCES |
| Sequence | USAGE, SELECT, UPDATE |
| Function, procedure, routine | EXECUTE |
| Type, domain | USAGE |
| Language | USAGE |
| Foreign data wrapper | USAGE |
| Foreign server | USAGE |
| Tablespace | CREATE |
| Large object | SELECT, UPDATE |
| Configuration parameter | SET, ALTER SYSTEM on 15 and later |

Each object category supports GRANT, REVOKE, ALL PRIVILEGES, grant options, grant-option-only revocation, and RESTRICT or CASCADE where the SQL grammar permits them. TEMPORARY is the canonical spelling of TEMP.

- Named objects are supported for every listed class. SQL `TABLE` syntax also covers views and foreign tables. Their actual capabilities depend on the relation kind and foreign server.
- `ALL ... IN SCHEMA` is offered only for tables, sequences, functions, procedures, and routines. It affects existing objects, not future ones.
- Column operations use one column set for each selected permission. Add another operation for a different column set.
- Routine overloads use one routine name and explicit input argument types per operation. Leave argument types blank for a zero-argument routine. Omit pure OUT arguments. Unusual signatures must be reviewed and adapted manually.
- Default privileges support future tables, sequences, routines, types including domains, and schemas. Defaults for schemas must be database-global, without `IN SCHEMA`.
- Routine defaults use `ON FUNCTIONS`, which includes both functions and procedures for all supported majors. Default privileges cannot separate functions from procedures.
- Multiple creator roles, recipient roles, and schema names are supported.

PostgreSQL predefined roles appear separately in **Membership**. The list follows the selected major. `pg_database_owner` is disabled because membership is implicit. Server-file and server-program roles are disabled for Aurora. Other Aurora built-in assignments require release-specific availability and grant authority. AWS-managed `rds*` and `aurora*` roles are not generated.

## Access profiles

- **Reader** grants database CONNECT, schema USAGE, and table SELECT on existing and future tables.
- **Read + write** adds INSERT, UPDATE, DELETE, and sequence USAGE. It does not add TRUNCATE, sequence UPDATE/setval, schema CREATE, or routine execution.
- **Routine executor** grants database CONNECT, schema USAGE, and EXECUTE on all existing and future routines in the selected schemas. Use an allowlist in **Object grants** instead if not every routine is suitable.

The setup creates a NOLOGIN group with conservative attributes. On reruns it rejects an existing LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, or NOINHERIT group. It does not silently convert existing roles. Compatible existing groups may still own objects or have extra permissions and memberships. The script adds access without resetting these.

Creator roles and member users must already exist. Login creation and passwords are outside this app. On PostgreSQL 16–17, setup grants membership with `ADMIN FALSE, INHERIT TRUE, SET FALSE`. On 14–15, automatic inheritance follows the member role's INHERIT attribute, and membership allows SET ROLE. The setup does not change user-wide attributes on those versions.

## Security boundaries

Roles and memberships are cluster-wide. Most object grants and all default privileges are database-specific. Database and tablespace grants name cluster objects. Run each script in its intended database and repeat database-local configuration for other databases.

Defaults follow the role actually creating an object, not merely its schema owner or a role it belongs to. Configure every creator or use `SET ROLE` consistently during deployment.

Per-schema defaults add to global defaults. A per-schema REVOKE cannot cancel global grants or built-in PUBLIC permissions. PostgreSQL normally grants PUBLIC EXECUTE on new routines and PUBLIC USAGE on new types. Restricting that access needs a global default REVOKE for each creator and separate revokes on existing objects. Revocation can break dependent applications.

Privileges are additive through PUBLIC, direct grants, memberships, and ownership. A role named reader is not a read-only guarantee. RLS, views, SECURITY DEFINER routines, existing grants, and other memberships can change effective access. The tool does not edit RLS policies, ownership, ALTER/DROP authority, privileged role attributes, AWS IAM, parameter groups, or host configuration.

Aurora `rds_superuser` is not a PostgreSQL superuser. Managed host operations, tablespaces, extensions, language support, and parameter changes have AWS restrictions. In particular, normal `ALTER SYSTEM` administration is replaced by managed parameter groups. A syntactically valid GRANT is not evidence that AWS permits the operation.

Names are entered without SQL quoting and quoted by the generator. Lists use commas or newlines. Qualified objects use `schema.name`. Names containing literal dots or list delimiters cannot be represented by these controls. Internal double quotes are escaped, control characters and names longer than 63 UTF-8 bytes are rejected, and SQL-like name text remains a quoted identifier. Routine argument types use a restricted grammar rather than raw SQL. No free-form SQL editor is exposed.

Generated scripts use a transaction, with no automatic execution. Transactions do not convert PostgreSQL's partial-grant warnings into errors. Scripts are additive except where the user explicitly selects REVOKE. CASCADE can affect other users' dependent grants. No DROP ROLE, DROP OWNED, or ownership transfer operations are generated.

## Test

Node.js 22 or later runs the dependency-free generator tests:

```sh
npm test
```

The local integration test creates a uniquely named disposable database and roles, executes generated SQL, asserts effective access, and cleans up its own objects. It requires a local PostgreSQL 17 superuser. It refuses nonlocal hosts. Do not point it at a production server.

```sh
PGHOST=/tmp PGPORT=5544 PGUSER=postgres npm run test:postgres
```

The browser suite uses `puppeteer-core` and a local Chrome or Chromium executable. Install the test-only dependency without changing the app:

```sh
npm install --no-save --package-lock=false puppeteer-core
python3 -m http.server 8086 --bind 127.0.0.1
# In a second terminal:
SITE_URL=http://127.0.0.1:8086/ CHROME_BIN=/usr/bin/google-chrome npm run test:ui
```

Set `ARTIFACTS` to change the screenshot and download output directory. The default is `/workspace/pg-role-grantor-artifacts`. The browser suite verifies the actual clipboard, downloaded bytes, offline reload, keyboard tabs, validation, and both responsive layouts. It also rejects unexpected external HTTP requests and browser errors.

Verified in this build: 33 generator tests, 87 real SQL integration checks on PostgreSQL **17.5**, and 29 browser checks on Chrome **156.0.8078.47**. The psql client is 17.11; the tested server is 17.5. Majors 14–16 have catalog and generator tests, not live-engine tests. No Aurora cluster was used.

## Host as a static site

Publish these static files to any HTTPS static host. GitHub Pages can serve the repository root from the `main` branch with `.nojekyll`. No build command or environment variables are needed. Relative module and asset paths support a project subpath such as `/pg-role-grantor/`.

Publishing is a separate action from generating SQL. A local build does not prove a public site is deployed. Verify the live URL and browser behavior after deployment. When releasing changed application files, bump the service-worker cache version in `sw.js`.

## References

The checked-in [versioned catalog evidence](docs/catalog-evidence.json) records the official synopsis for each supported major. [Design choices](docs/architecture.md) describe the stateless operation plan. [Examples](EXAMPLES.md) show common workflows.

- [PostgreSQL 14 GRANT](https://www.postgresql.org/docs/14/sql-grant.html), [15 GRANT](https://www.postgresql.org/docs/15/sql-grant.html), [16 GRANT](https://www.postgresql.org/docs/16/sql-grant.html), [17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html)
- [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
- [PostgreSQL REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html)
- [PostgreSQL predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html)
- [Aurora role restrictions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
