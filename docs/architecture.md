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
