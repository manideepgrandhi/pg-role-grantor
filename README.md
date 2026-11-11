# PG role grantor

Live site: [manideepgrandhi.github.io/pg-role-grantor](https://manideepgrandhi.github.io/pg-role-grantor/)

A browser-only SQL generator for PostgreSQL and Aurora PostgreSQL. Build a role and privilege plan, inspect the SQL, then copy or download one standalone script.

No database connections, stored secrets, login screens, execution, analytics, external fonts, or runtime package dependencies. Form values and plans stay in memory. Reloading clears them. A service worker caches application files for offline use after the first successful visit.

## Run locally

Use Python 3 to serve the files:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080`. ES modules need HTTP, so opening `index.html` directly with `file://` is not supported. Clipboard access and service workers require HTTPS or localhost.

## Build a script

1. Select the engine (PostgreSQL or Aurora PostgreSQL) and a supported major version. PostgreSQL 17 is the default.
2. In **Operation**, keep **Access setup** for a reader, read-write, or routine-executor group. Replace every `example_` value with your own name.
3. Enter the database and schemas. **Future object creators** and **Assign to users / roles** are optional and start blank.
4. Select **Add to script**.
5. Pick another operation (**Grants**, **Membership**, **Create role**, or **FDW setup**) to add more. Remove an operation to replace it.
6. Expand items in **Script plan** and read **Before you run this**.
7. Select **Copy SQL** or **Download .sql**. Run the script yourself in the intended database using an account with the required authority.

Optional fields show a grey placeholder instead of an example value. Required fields keep `example_` values to replace.

**Create role** makes a reusable NOLOGIN group by default. Check **WITH LOGIN** to create a role that can sign in instead. A visible **Password** field appears with a 16-character random password (letters, digits, `!@#$%^&*_-`) generated in your browser with `crypto.getRandomValues`. Edit it or select **Regenerate**. Each check of **WITH LOGIN** starts with a new password, and unchecking removes the field and the `PASSWORD` clause. The password lives only in page memory: it is never saved, sent, or logged by the site, and reloading or **Reset form** clears it. It does appear in the form and in the copied or downloaded setup SQL, because that is the script you run. The script header then warns that statement logs, client history, and the file itself can expose it. The plan, review, and verification SQL say only that a password was set. Verification never reads `rolpassword` or `pg_authid`.

A LOGIN role gets the same conservative attributes as a group: `LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`. On reruns an existing compatible LOGIN role is left unchanged, including its current password; rotate it yourself with `ALTER ROLE ... PASSWORD`. An existing NOLOGIN, elevated, or NOINHERIT role is rejected, and so is an existing LOGIN role when you create a NOLOGIN group. Empty passwords and control characters are rejected. **Access setup** groups never get LOGIN or a password.

The **FDW setup** operation also generates extension, foreign-server, explicit local-role-to-remote-user mappings, optional schema import or a structured foreign table, and required local grants. Passwords are placeholders only, with blocking preflight guards. Private substitutions accept UTF-8 hex only, never raw passwords in this site. See the [FDW reference](docs/fdw.md).

The app does not discover objects or verify names, creator roles, ownership, or grant authority. PostgreSQL can issue warnings and grant only a subset of the requested privileges. Inspect server output and resulting ACLs, even after a successful transaction.

Changing the platform or major version revalidates the entire plan. Export is disabled if any operation becomes incompatible. Each operation, and each side of the **Grants** toggle, keeps its form draft in memory. Changing the target or reloading the page resets those drafts. Operations already added to the plan remain until removed, cleared, or the page reloads.

**Reset form** restores only the current form (for **Grants**, only the visible Existing or Future side) to its initial values and clears its validation messages. It keeps the script plan, selected platform and version, and other drafts. **Clear plan** asks for confirmation when the plan contains operations. Cancel keeps everything unchanged. Confirm removes only queued SQL, not the current form or target.

## Grant existing or future objects

**Grants** has a toggle bar:

- **Existing objects** generates GRANT or REVOKE on objects that exist now, by name or as `ALL ... IN SCHEMA`.
- **Future objects** generates `ALTER DEFAULT PRIVILEGES`. Creators and schema scope are optional. A blank schema scope is database-wide. Schema defaults are always database-wide.

Object types are checkboxes. Table, schema, database, sequence, and routine are shown first. The rest are under **More**. Tables, views, and foreign tables are one type because PostgreSQL grants them all with `TABLE` syntax.

Check several types to grant them in one step. One **Add to script** creates one statement per type, and each type gets only the checked permissions it supports. For example, Table and Sequence with SELECT and USAGE in schema scope generate:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA "example_schema" TO "example_app";
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA "example_schema" TO "example_app";
```

Every checked type must receive at least one checked permission. Otherwise the form shows an error, for example when only USAGE is checked with Table. A permission that no checked type supports is also an error. **ALL PRIVILEGES** is applied per type. Named objects apply the same names to each type, so schema-wide scope is usually better when types differ. Columns, large objects, and parameters need their own fields and are always granted one type at a time. Checking one clears the other types. Named functions, procedures, and routines also need their own operation to identify an exact overload.

## Choose multiple permissions or roles

**Grants** uses checkbox groups for permissions. **Select all** checks every listed individual permission. **Clear all** unchecks the group. The separate **ALL PRIVILEGES** checkbox generates PostgreSQL's `ALL PRIVILEGES` syntax and cannot stay checked with individual permissions.

Changing the object types keeps only shared individual selections. It clears **ALL PRIVILEGES** rather than applying broad access to another object type. If no selections remain, choose permissions before adding the operation.

**Membership** combines the **Roles to grant** text list with roles checked under the collapsed **Predefined PostgreSQL roles** section. Duplicate names appear once in the generated membership statement. No predefined roles are checked automatically, and the text list starts empty. Enter a role or check a predefined role. **Select all** includes every available predefined role, including powerful roles on PostgreSQL. Review the role descriptions and generated warnings before adding the operation. Unavailable roles stay disabled for the selected platform and major version.

Single-choice settings stay as dropdowns or profile buttons. Schema, object, creator, and custom role names remain text inputs because the site does not connect to a database.

## Review requests and inspect the result

**Script plan** lists queued requests in their original order. Expand each item to see recipients, privileges, object or schema scope, grant options, creators, and memberships. Profiles expand into group creation, existing-object grants, future defaults, and membership. Multi-type grants list one line per type. Blank creators are shown as "no creators listed", meaning only objects created by the role that runs the script (`CURRENT_USER`). FDW items include role mappings, import or manual-table intent, and local grants. Form drafts are not included.

The summary describes intent, not verified database state or a calculated final ACL. Duplicate and conflicting requests remain visible. A later REVOKE can supersede an earlier GRANT.

**Copy SQL** and **Download .sql** export the setup script, `permission-plan.sql`. After executing that reviewed script yourself, expand **Verification SQL** under the preview to copy or download `permission-verification.sql`. Opening it does not replace the setup preview. The site never runs either script. Verification consists only of SELECT queries against local catalogs and built-in privilege inquiry functions. It does not execute target routines, create future test objects, retrieve mapping credentials, or contact foreign servers.

Each inspection result contains the requested operation and JSON evidence. Compare these fields yourself:

- `explicit_acl_privilege` and `explicit_acl_grant_option` describe stored direct ACL entries for the exact recipient. A null ACL has no explicit entries, even when PostgreSQL grants built-in access.
- `effective_privilege` and `effective_grant_option` separately include PostgreSQL's effective access rules. Inherited roles, PUBLIC, owners, and superusers can retain access after a direct revoke. These functions do not prove row access through RLS or that a view or foreign table supports the requested operation.
- Default-ACL evidence distinguishes explicit global and per-schema rows, global or built-in privileges, and their additive combination for the exact creator and recipient. With blank creators, it inspects `CURRENT_USER`, so run it as the role that ran the setup. It reports configured defaults, not a live test of future object creation or inherited access.
- Membership evidence includes direct rows and grantors, ADMIN, indirect membership, and immediately inherited role usage. PostgreSQL 16–17 also report per-membership INHERIT and SET. Versions 14–15 report the member role's INHERIT attribute instead.
- FDW evidence includes extension/server presence, mapping presence, local foreign-table inventories, owners, column types, nullability, and local ACLs. It selects only mapping identifiers from `pg_user_mappings`, never `umoptions`. Remote usernames, passwords, connection options, TLS, remote authority, column mapping options, and import completeness are not verified.

There are no automatic PASS verdicts. Missing roles, columns, or named objects produce missing-status rows. An empty all-in-schema inventory reports no matching objects or a missing schema. Large objects expose explicit ACL evidence only, with effective-access columns null. CASCADE effects on unrelated grantees are not audited.

Run verification in the intended database, with the same `search_path` and selected PostgreSQL major version. The first query reports the connected database, inspecting role, and actual major. Catalog permissions or visibility can limit results. No Aurora runtime validation is implied. Use the same unchanged plan to generate both files.

## Coverage

The catalog supports upstream PostgreSQL majors **14, 15, 16, and 17**. It does not claim support for 18 or later. Aurora mode uses the selected upstream major's SQL grammar and displays managed-service restrictions. It does not certify every Aurora engine minor release or regional availability.

| Object level                 | Grantable permissions                                                         |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Database                     | CONNECT, CREATE, TEMPORARY                                                    |
| Schema                       | USAGE, CREATE                                                                 |
| Table, view, foreign table   | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; MAINTAIN on 17 |
| Column                       | SELECT, INSERT, UPDATE, REFERENCES                                            |
| Sequence                     | USAGE, SELECT, UPDATE                                                         |
| Function, procedure, routine | EXECUTE                                                                       |
| Type, domain                 | USAGE                                                                         |
| Language                     | USAGE                                                                         |
| Foreign data wrapper         | USAGE                                                                         |
| Foreign server               | USAGE                                                                         |
| Tablespace                   | CREATE                                                                        |
| Large object                 | SELECT, UPDATE                                                                |
| Configuration parameter      | SET, ALTER SYSTEM on 15 and later                                             |

Each object category supports GRANT, REVOKE, ALL PRIVILEGES, grant options, grant-option-only revocation, and RESTRICT or CASCADE where the SQL grammar permits them. TEMPORARY is the canonical spelling of TEMP.

- Named objects are supported for every listed class. SQL `TABLE` syntax also covers views and foreign tables. Their actual capabilities depend on the relation kind and foreign server.
- `ALL ... IN SCHEMA` is offered only for tables, sequences, functions, procedures, and routines. It affects existing objects, not future ones.
- Column operations use one column set for each selected permission. Add another operation for a different column set.
- Routine overloads use one routine name and explicit input argument types per operation. Leave argument types blank for a zero-argument routine. Omit pure OUT arguments. Unusual signatures must be reviewed and adapted manually.
- Default privileges support future tables, sequences, routines, types including domains, and schemas. Defaults for schemas must be database-global, without `IN SCHEMA`.
- Routine defaults use `ON FUNCTIONS`, which includes both functions and procedures for all supported majors. Default privileges cannot separate functions from procedures.
- Multiple creator roles, recipient roles, and schema names are supported. Creators are optional. Without creators, `FOR ROLE` is omitted and defaults apply only to objects later created by the role that runs the script.

PostgreSQL predefined roles appear separately in **Membership**. The list follows the selected major. `pg_database_owner` is disabled because membership is implicit. Server-file and server-program roles are disabled for Aurora. Other Aurora built-in assignments require release-specific availability and grant authority. AWS-managed `rds*` and `aurora*` roles are not generated.

## Access profiles

- **Reader** grants database CONNECT and schema USAGE, plus, on existing objects and as future defaults in the selected schemas:
  - SELECT on tables, views, and foreign tables
  - SELECT and USAGE on sequences
  - EXECUTE on functions. Existing grants use `ALL FUNCTIONS` (not procedures). Defaults use `ON FUNCTIONS`, which PostgreSQL also applies to future procedures.
  - USAGE on types, as a future default only. PostgreSQL has no `GRANT ... ON ALL TYPES IN SCHEMA`, so add a named type grant for existing types.
- **Read + write** includes everything in Reader, plus INSERT, UPDATE, DELETE, and TRUNCATE on tables. It does not add sequence UPDATE/setval or schema CREATE.
- **Routine executor** grants database CONNECT, schema USAGE, and EXECUTE on all existing and future routines in the selected schemas. Use named routines in **Grants** instead if not every routine is suitable.

Sequence USAGE allows `nextval`, which increments sequences. EXECUTE on all functions in a schema includes functions that write data or run as SECURITY DEFINER. Use **Grants** with named objects if that is too broad.

The setup creates a NOLOGIN group with conservative attributes. On reruns it rejects an existing LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS, or NOINHERIT group. It does not silently convert existing roles. Compatible existing groups may still own objects or have extra permissions and memberships. The script adds access without resetting these.

Listed creator roles and member users must already exist. Leave creators blank to cover only objects created by the role that runs the script. Access setup never creates logins or takes passwords; use **Create role** with **WITH LOGIN** for that. On PostgreSQL 16–17, setup grants membership with `ADMIN FALSE, INHERIT TRUE, SET FALSE`. On 14–15, automatic inheritance follows the member role's INHERIT attribute, and membership allows SET ROLE. The setup does not change user-wide attributes on those versions.

## Security boundaries

Roles and memberships are cluster-wide. Most object grants and all default privileges are database-specific. Database and tablespace grants name cluster objects. Run each script in its intended database and repeat database-local configuration for other databases.

Defaults follow the role actually creating an object, not merely its schema owner or a role it belongs to. Configure every creator or use `SET ROLE` consistently during deployment. Blank creators configure only the role that runs the script, not other owner or creator roles.

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

Set `ARTIFACTS` to change the screenshot and download output directory. The default is `/workspace/pg-role-grantor-artifacts`. The browser suite verifies the actual clipboard, downloaded bytes, offline reload, the operation dropdown, the Grants toggle, placeholders, keyboard controls, validation, and both responsive layouts. It also rejects unexpected external HTTP requests and browser errors.

Verified in this build (2026-11-11): 89 generator, password, and review tests, and 79 general browser checks, 27 FDW browser checks, 149 reset browser checks, 201 checkbox browser checks, and 87 summary and verification browser checks on Chrome **156.0.8078.47**. The generated LOGIN SQL was syntax-checked with the PostgreSQL 17 parser (libpg-query) using fixed fixture passwords. The PostgreSQL integration suites do not yet cover WITH LOGIN and were not rerun in this build, because no local PostgreSQL server was available. They last passed on PostgreSQL **17.5** before the v7 change. Majors 14–16 have catalog and generator tests, not live-engine tests. No Aurora cluster was used.

Run the reset browser suite against the same local server:

```sh
SITE_URL=http://127.0.0.1:8086/ CHROME_BIN=/usr/bin/google-chrome npm run test:reset-ui
```

It checks every operation and both Grants sides, preserved drafts and queued SQL, version-aware defaults, FDW rows and modes, validation cleanup, keyboard activation and focus, Clear plan cancellation and confirmation, and mobile width. Set `SITE_URL` to the deployed HTTPS URL to run browser checks against the public site.

Run the multi-selection browser suite with the same server and test dependency:

```sh
SITE_URL=http://127.0.0.1:8086/ CHROME_BIN=/usr/bin/google-chrome npm run test:checkbox-ui
```

It checks multi-type, multi-permission, and multi-role SQL, the More disclosure, exclusive single-type kinds, Existing / Future drafts, Select all and Clear all, ALL PRIVILEGES exclusivity, empty-choice validation, version and platform restrictions, Reset form, preserved queued SQL and other drafts, keyboard controls, offline generation, and desktop and mobile layouts.

Run the summary and verification browser suite with the same server:

```sh
SITE_URL=http://127.0.0.1:8086/ CHROME_BIN=/usr/bin/google-chrome npm run test:review-ui
```

This suite checks every operation, the expandable script plan, blank-creator wording, the Verification SQL disclosure, actual clipboard and downloaded bytes, draft preservation, reset, version restrictions, keyboard controls, mobile layout, and offline generation. The local PostgreSQL suites also execute the generated inspection queries in read-only transactions before and after permission changes.

## Test native FDW setup

The FDW suite creates and destroys its own temporary local PostgreSQL cluster. It needs PostgreSQL 17 server binaries with `postgres_fdw` installed, plus `psql` in PATH. Run it as a non-root OS user:

```sh
PG_BIN=/path/to/postgresql/bin npm run test:fdw
```

It creates two disposable databases, ephemeral SCRAM credentials, and loopback-only connections. It tests full import, LIMIT TO, EXCEPT, manual definitions, real reads and writes through distinct local sessions, remote authorization failures, the group-mapping caveat, quote escaping, guards, scoped grants, and collision rollback. Credentials never enter source files, screenshots, or exported examples. The temporary cluster is removed afterward. No external database is contacted. Live TLS certificate verification and Aurora are not tested.

With the local site server and test-only Puppeteer dependency available, run:

```sh
SITE_URL=http://127.0.0.1:8086/ CHROME_BIN=/usr/bin/google-chrome npm run test:fdw-ui
```

This suite checks mapping and column rows, mode selection, duplicate mapping validation, downloaded SQL, mobile labels and width, and FDW generation after an offline reload.

## Host as a static site

The public site is [manideepgrandhi.github.io/pg-role-grantor](https://manideepgrandhi.github.io/pg-role-grantor/).

Publish these static files to any HTTPS static host. GitHub Pages can serve the repository root from the `main` branch with `.nojekyll`. No build command or environment variables are needed. Relative module and asset paths support a project subpath such as `/pg-role-grantor/`.

Publishing is a separate action from generating SQL. A local build does not prove a public site is deployed. Verify the live URL and browser behavior after deployment. When releasing changed application files, bump the service-worker cache version in `sw.js`.

## Changelog

- **v9** (2026-11-12) Footer adds a **More tools** list of the other live sites (home, DB Cheat Sheet, pg-commands, Paisa Diary, Office Days, and the three RDS compliance What's new pages). Generator behaviour is unchanged. Service-worker cache `pg-role-grantor-v9`.
- **v8** (2026-11-11) **Create role** adds an optional **WITH LOGIN** checkbox. Checking it shows a visible Password field with a 16-character random password from `crypto.getRandomValues` (unbiased, letters, digits, `!@#$%^&*_-`), editable, with **Regenerate**. The SQL becomes `CREATE ROLE ... LOGIN PASSWORD ...` with the same conservative attributes. Reruns leave an existing compatible LOGIN role and its password unchanged, and reject NOLOGIN or elevated roles. The password stays in memory only. It appears in the setup SQL, with a header warning, but never in the plan, review, or verification SQL. Default Create role, Access setup, and FDW are unchanged. Service-worker cache `pg-role-grantor-v8`.
- **v7** (2026-11-11) Simpler UI: one **Operation** dropdown replaces the tabs, engine and version sit on one line, and the intro and badges are gone. **Grants** merges object grants and defaults with an Existing / Future toggle and multi-select object types (one statement per type, unsupported permissions skipped). Script plan and Permission summary are one expandable list. Verification SQL moved into its own disclosure. Future object creators are optional: blank omits `FOR ROLE`. Optional fields start blank with placeholders. Reader now adds sequence SELECT + USAGE, function EXECUTE, and future type USAGE. Writer adds TRUNCATE. Service-worker cache `pg-role-grantor-v7`.

## References

Run `npm run examples` to regenerate the standalone SQL examples from `examples/generate.js`. The test suite checks them against the current generator.

The checked-in [versioned catalog evidence](docs/catalog-evidence.json) records the official synopsis for each supported major. [Design choices](docs/architecture.md) describe the stateless operation plan. [Examples](EXAMPLES.md) show common workflows.

- [PostgreSQL 14 GRANT](https://www.postgresql.org/docs/14/sql-grant.html), [15 GRANT](https://www.postgresql.org/docs/15/sql-grant.html), [16 GRANT](https://www.postgresql.org/docs/16/sql-grant.html), [17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html)
- [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
- [PostgreSQL REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html)
- [PostgreSQL predefined roles](https://www.postgresql.org/docs/17/predefined-roles.html)
- [Aurora role restrictions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
