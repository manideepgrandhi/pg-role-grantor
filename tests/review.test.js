import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../src/catalog.js";
import { generate } from "../src/generator.js";
import { summarize, expandOperation } from "../src/plan-review.js";
import { generateVerification } from "../src/verification.js";
const ctx = { platform: "postgres", version: 17 };
const base = {
  kind: "object",
  object: "table",
  targets: "s.items",
  grantees: "app,reporter",
  privileges: ["SELECT"],
  action: "grant",
};
const profile = {
  kind: "profile",
  profile: "writer",
  group: "access",
  database: "example_db",
  schemas: "s",
  creators: "owner",
  members: "app",
};
const fdw = {
  kind: "fdw",
  server: "example_server",
  localDatabase: "example_db",
  host: "remote.example.invalid",
  port: "5432",
  database: "remote_db",
  mappings: [{ localRole: "app", remoteUser: "remote_reader" }],
  sslmode: "verify-full",
  access: "reader",
  mode: "import",
  localSchema: "foreign_schema",
  remoteSchema: "source",
  importAs: "app",
  importFilter: "limit",
  tables: "items",
};
// User text only enters escaped SQL literals. Audit tokens after removing those literals and comments.
function readOnly(sql) {
  const code = sql
    .replace(/E?'(?:''|\\.|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, "");
  for (const statement of code
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    assert.match(statement, /^(SELECT|WITH)\b/i);
  assert.doesNotMatch(
    code,
    /\b(INSERT|UPDATE|DELETE|GRANT|REVOKE|ALTER|CREATE|DROP|COPY|CALL|DO|SET|RESET|TRUNCATE|LOCK|INTO)\b/i,
  );
  const safe = [
    "lower",
    "jsonb_build_object",
    "jsonb_agg",
    "to_jsonb",
    "current_database",
    "current_setting",
    "format",
    "pg_get_function_identity_arguments",
    "to_regtype",
    "array_length",
    "aclexplode",
    "acldefault",
    "pg_has_role",
    "format_type",
    "pg_table_is_visible",
    "pg_function_is_visible",
    "pg_type_is_visible",
  ];
  for (const m of code.matchAll(/\bpg_catalog\.([a-z_]+)\s*\(/g))
    assert.ok(
      safe.includes(m[1]) ||
        /^has_(table|column|database|schema|sequence|function|type|language|foreign_data_wrapper|server|tablespace|parameter)_privilege$/.test(
          m[1],
        ),
      m[1],
    );
  assert.doesNotMatch(
    code,
    /\b(umoptions|srvoptions|attfdwoptions|rolpassword|pg_authid)\b/i,
  );
}
for (const platform of ["postgres", "aurora"])
  for (const version of [14, 15, 16, 17])
    test(`${platform} ${version}: complete summary/inspection privilege matrix`, () => {
      const context = { platform, version };
      for (const [object, entry] of Object.entries(catalog(version)))
        for (const action of ["grant", "revoke"]) {
          const op = {
            ...base,
            object,
            action,
            targets: entry.routine
              ? "s.routine"
              : object === "largeobject"
                ? "12345"
                : "s.items",
            argTypes: "integer\ntext",
            columns: "id,value",
            privileges: entry.privileges,
          };
          if (action === "revoke") op.optionOnly = true;
          else op.grantOption = true;
          const summary = summarize(context, [op]);
          assert.ok(summary[0].title.includes(action.toUpperCase()));
          assert.ok(summary[0].title.includes("app, reporter"));
          const generated = generateVerification(context, [op]).sql;
          readOnly(generated);
          assert.ok(generated.includes("explicit_acl_grant_option"));
          assert.ok(generated.includes("MISSING_RECIPIENT"));
          readOnly(
            generateVerification(context, [
              {
                ...op,
                grantOption: false,
                optionOnly: false,
                public: true,
                privileges: ["ALL PRIVILEGES"],
              },
            ]).sql,
          );
          if (entry.all)
            readOnly(
              generateVerification(context, [
                { ...op, scope: "all", schemas: "s,empty_schema" },
              ]).sql,
            );
          if (entry.defaults)
            for (const schemas of object === "schema"
              ? [""]
              : ["", "s,another_schema"]) {
              const defaults = {
                ...op,
                kind: "default",
                schemas,
                creators: "owner,other_owner",
              };
              const sql = generateVerification(context, [defaults]).sql;
              readOnly(sql);
              assert.ok(sql.includes("global_or_builtin_privilege"));
              assert.ok(sql.includes("combined_exact_recipient_privilege"));
              assert.ok(
                summarize(context, [defaults])[0].title.includes(
                  "owner, other_owner",
                ),
              );
            }
        }
      const member = {
        kind: "membership",
        roles: "pg_monitor,custom_access",
        members: "app",
        admin: false,
        ...(version >= 16 ? { inherit: true, set: false } : {}),
      };
      const sql = generateVerification(context, [member]).sql;
      readOnly(sql);
      assert.equal(sql.includes("a.inherit_option"), version >= 16);
      assert.equal(sql.includes("a.set_option"), version >= 16);
    });
for (const kind of ["reader", "writer", "executor"])
  test(`${kind} profile expansion agrees with setup SQL`, () => {
    const op = { ...profile, profile: kind };
    const expanded = expandOperation(ctx, op),
      sql = generate(ctx, [op]).sql;
    for (const part of expanded) {
      const generated = generate(ctx, [part]).sql;
      const body = generated.split("BEGIN;\n\n")[1].split("\n\nCOMMIT;")[0];
      assert.ok(sql.includes(body), part.kind);
    }
    const details = summarize(ctx, [op])[0].details.join("\n");
    assert.ok(details.includes("creators owner"));
    assert.ok(details.includes("membership access to app"));
    assert.ok(details.includes("NOLOGIN"));
    assert.equal(
      details.includes("USAGE on all existing SEQUENCES"),
      kind === "writer",
    );
    readOnly(generateVerification(ctx, [op]).sql);
  });
for (const mode of ["server", "import", "manual"])
  test(`${mode} FDW summary and local-only evidence`, () => {
    const op =
      mode === "server"
        ? {
            ...fdw,
            mode,
            localSchema: "",
            remoteSchema: "",
            importAs: "",
            tables: "",
          }
        : mode === "manual"
          ? {
              ...fdw,
              mode,
              importAs: "",
              tables: "",
              localTable: "items",
              remoteTable: "items",
              columns: [{ localName: "id", type: "integer", notNull: true }],
            }
          : fdw;
    const summary = summarize(ctx, [op])[0];
    assert.ok(summary.title.includes("app → remote user remote_reader"));
    assert.ok(summary.title.includes("remote.example.invalid:5432/remote_db"));
    assert.ok(summary.details.some((x) => x.includes("CONNECT")));
    assert.ok(summary.details.some((x) => x.includes("USAGE")));
    const sql = generateVerification(ctx, [op]).sql;
    readOnly(sql);
    assert.ok(sql.includes("pg_catalog.pg_user_mapping"));
    assert.ok(!sql.includes("PASSWORD_HEX"));
    assert.equal(sql.includes("'foreign_tables'"), mode !== "server");
  });
test("ordered conflicting requests remain separate, with complete grant-option and creator intent", () => {
  const operations = [
    base,
    { ...base, action: "revoke", optionOnly: true, behavior: "CASCADE" },
    {
      kind: "default",
      object: "schema",
      creators: "creator_a,creator_b",
      schemas: "",
      grantees: "app",
      privileges: ["USAGE"],
      grantOption: true,
    },
  ];
  const result = summarize(ctx, operations);
  assert.deepEqual(
    result.map((x) => x.number),
    [1, 2, 3],
  );
  assert.match(result[1].title, /REVOKE grant option only.*CASCADE/);
  assert.match(
    result[2].title,
    /creator_a, creator_b.*database-global.*WITH GRANT OPTION/,
  );
  assert.equal(summarize(ctx, []).length, 0);
});
test("missing types use guarded OID lookup and custom strings remain inert literals", () => {
  const op = {
    ...base,
    object: "function",
    targets: "missing_schema.func",
    argTypes: "missing_schema.missing_type",
    privileges: ["EXECUTE"],
    grantees: 'app"; DROP ROLE victim; --',
  };
  const sql = generateVerification(ctx, [op]).sql;
  readOnly(sql);
  assert.match(sql, /to_regtype\(E'"missing_schema"\."missing_type"'\)/);
  assert.match(sql, /recipient_oid IS NULL/);
});
test("empty ACLs are guarded before aclexplode, and inspection never emits PASS verdicts", () => {
  const sql = generateVerification(ctx, [
    base,
    {
      kind: "default",
      object: "type",
      creators: "owner",
      public: true,
      privileges: ["USAGE"],
      schemas: "s",
    },
  ]).sql;
  assert.ok(sql.includes("aclexplode(CASE WHEN pg_catalog.array_length"));
  assert.ok(sql.includes("acldefault('T',creator.oid)"));
  assert.ok(!sql.includes("'PASS'"));
  readOnly(sql);
});
test("invalid source plans fail closed in summaries and verification", () => {
  for (const op of [
    { ...base, privileges: [] },
    { ...base, object: "unknown" },
    { ...base, privileges: ["EXECUTE"] },
    { kind: "membership", roles: "pg_database_owner", members: "app" },
  ]) {
    assert.throws(() => summarize(ctx, [op]));
    assert.throws(() => generateVerification(ctx, [op]));
  }
});
test("FDW single identifiers retain dots and commas without becoming extra targets", () => {
  const op = {
    ...fdw,
    mode: "manual",
    server: "server,one",
    localSchema: "schema.one",
    localTable: "table,one",
    remoteTable: "items",
    importAs: "",
    tables: "",
    columns: [{ localName: "id", type: "integer" }],
  };
  const sql = generateVerification(ctx, [op]).sql;
  readOnly(sql);
  assert.ok(sql.includes("n.nspname=E'schema.one'"));
  assert.ok(sql.includes("c.relname=E'table,one'"));
  assert.ok(sql.includes("c.srvname=E'server,one'"));
});

test("summary and verification generation do not mutate source operations", () => {
  const operations = JSON.parse(JSON.stringify([profile, fdw, base]));
  const original = JSON.stringify(operations);
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(operations);
  summarize(ctx, operations);
  generateVerification(ctx, operations);
  assert.equal(JSON.stringify(operations), original);
});
