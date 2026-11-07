# Generator architecture

## Two designs considered

A guided wizard with one large form is compact, but it forces unrelated object permissions into the same state. Adding a second grant would overwrite the first.

A small operation builder with a script plan keeps each operation separate. Each operation is plain data. A pure generator validates it against the selected version and returns SQL plus warnings. The UI stores the plan in memory and recompiles the complete plan when the platform changes.

The second design is the implementation. It supports a reader/writer setup in one step and separate grants, defaults, and memberships in the same downloaded script.

## Module boundaries

- `src/catalog.js`: supported majors, object classes, permissions, and predefined roles.
- `src/generator.js`: `generate(context, operations)` returns `{sql, warnings}` or throws an input error. It has no browser or database dependencies.
- `src/app.js`: forms, plan state, preview, copy, and download.
- `sw.js`: static application cache only. No form values enter the cache.

The UI never accepts SQL fragments. Identifiers are quoted. Routine argument types use a restricted type grammar, not raw expressions. Grant targets and keywords come from the catalog. A version switch revalidates every operation rather than relabeling stale SQL.

## Work checklist

- [x] Ground: separate greenfield application, no existing repository integration.
- [x] Sketch: compare wizard and operation-plan designs.
- [x] Agree: approved browser-only script generation, proceed without another checkpoint.
- [x] Implement: catalog, generator, UI, and documentation.
- [x] Verify: unit, PostgreSQL, desktop, mobile, and offline checks.

Ownership transfer, role attribute administration, RLS policy editing, AWS IAM, and database execution are outside this app. They are not object GRANT privileges.

## FDW extension of the design

The existing operation plan remains the only state owner. Previously, `generate(context, operations)` validated privilege operations, built warnings, and wrapped the resulting statements in one transaction. FDW adds another operation, not a database connection path.

Two designs were considered. Adding all connection and mapping rules directly to `generator.js` would keep one file, but mix remote-setup policy with the object-privilege catalog. A separate pure `fdwSetup(context, operation, index)` module contains that policy and returns `{guard, sql, warnings}`. The generator collects every FDW credential guard before any operation's mutations. This second design keeps the public entry point unchanged and avoids circular imports.

`src/sql-input.js` owns identifier quoting, SQL string escaping, constrained type parsing, and safe dollar-quote delimiters. `src/fdw.js` owns the FDW grammar, explicit user mappings, credential markers, table modes, and managed-service warnings. `src/form-fields.js` owns shared form controls. `src/fdw-form.js` owns structured mapping and column rows without SQL generation.

A generic option editor was rejected. Host, port, database, TLS, mappings, and table columns have explicit inputs. Passwords cannot be supplied to the generator. Private password substitutions accept UTF-8 hex only, so a previously unknown dollar-quote delimiter cannot terminate a generated DO body. Hex is decoded only inside the guarded SQL. Each mapping's password placeholder is bound once in its own guarded DO block before dynamic CREATE USER MAPPING. PostgreSQL `format` receives roles as `%I` and option values as `%L`. The import block switches to a separately mapped import role and restores the original execution role. Imported-table grants use catalog-selected relations, never all unrelated tables in a schema.

Verification includes an isolated native PostgreSQL cluster with SCRAM-authenticated loopback FDW connections. The script never reads user credentials, contacts a production endpoint, or publishes the project. TLS and Aurora runtime compatibility remain documented limits.
