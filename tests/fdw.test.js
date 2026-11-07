import test from "node:test";
import assert from "node:assert/strict";
import { generate } from "../src/generator.js";
const context = { version: 17, platform: "postgres" };
const base = {
  kind: "fdw",
  server: "example_server",
  localDatabase: "example_local",
  host: "remote.example.invalid",
  port: "5432",
  database: "example_remote",
  sslmode: "verify-full",
  localSchema: "foreign_data",
  remoteSchema: "remote_data",
  mappings: [
    { localRole: "app", remoteUser: "remote_app" },
    { localRole: "reporter", remoteUser: "remote_reader" },
  ],
  mode: "import",
  access: "reader",
  importAs: "app",
  importFilter: "limit",
  tables: "items",
};
const sql = (change = {}) => generate(context, [{ ...base, ...change }]).sql;
for (const version of [14, 15, 16, 17])
  for (const platform of ["postgres", "aurora"])
    test(`FDW ${platform} ${version}: mappings, import and guards`, () => {
      const result = generate({ version, platform }, [base]);
      assert.match(result.sql, /CREATE EXTENSION IF NOT EXISTS postgres_fdw/);
      assert.match(result.sql, /CREATE USER MAPPING FOR %I SERVER %I/);
      assert.match(result.sql, /E'remote_reader', mapping_password/);
      assert.match(result.sql, /sslmode E'verify-full'/);
      assert.match(
        result.sql,
        /IMPORT FOREIGN SCHEMA "remote_data" LIMIT TO \("items"\)/,
      );
      assert.ok(
        result.sql.indexOf("FDW password placeholder is unresolved") <
          result.sql.indexOf("\nCREATE EXTENSION"),
      );
      assert.ok(
        result.warnings.some((w) => w.includes("Remote-side checklist")),
      );
    });
test("FDW preflight precedes unrelated mutations and each mapping has a unique marker", () => {
  const result = generate(context, [
    { kind: "group", group: "new_group" },
    base,
  ]).sql;
  assert.ok(
    result.indexOf("FDW password placeholder is unresolved") <
      result.indexOf("CREATE ROLE"),
  );
  assert.match(result, /__REPLACE_FDW_2_MAPPING_1_PASSWORD_HEX__/);
  assert.match(result, /__REPLACE_FDW_2_MAPPING_2_PASSWORD_HEX__/);
  assert.match(
    result,
    /convert_from\(decode\(mapping_password_hex, 'hex'\), 'UTF8'\)/,
  );
  assert.match(result, /current_database\(\) <> E'example_local'/);
});
test("FDW import variants and narrowly selected grants", () => {
  assert.match(
    sql({ importFilter: "all", tables: "" }),
    /IMPORT FOREIGN SCHEMA "remote_data"\n/,
  );
  assert.match(
    sql({ importFilter: "exclude", tables: "private,secret" }),
    /EXCEPT \("private", "secret"\)/,
  );
  assert.match(sql(), /JOIN pg_catalog.pg_foreign_server/);
  assert.match(sql(), /s.srvname = E'example_server'/);
  assert.doesNotMatch(sql(), /GRANT SELECT ON ALL TABLES IN SCHEMA/);
  assert.match(sql(), /original_role name := current_user/);
  assert.match(sql(), /SET LOCAL ROLE %I/);
  assert.match(
    sql({ access: "writer" }),
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/,
  );
});
test("FDW structured manual table and server-only setup", () => {
  const manual = {
    mode: "manual",
    importAs: undefined,
    tables: "",
    localTable: "items",
    remoteTable: "remote_items",
    columns: [
      { localName: "id", type: "integer", notNull: true },
      {
        localName: "description",
        remoteName: "remote_description",
        type: "text[]",
      },
    ],
  };
  assert.match(sql(manual), /"id" integer NOT NULL/);
  assert.match(sql(manual), /OPTIONS \(column_name E'remote_description'\)/);
  assert.match(sql(manual), /GRANT SELECT ON TABLE "foreign_data"\."items"/);
  const server = {
    mode: "server",
    importAs: undefined,
    tables: "",
    remoteSchema: "",
    localSchema: "",
  };
  assert.doesNotMatch(sql(server), /CREATE SCHEMA/);
  assert.doesNotMatch(sql(server), /IMPORT FOREIGN SCHEMA/);
});
test("FDW SQL literals, dynamic block delimiters, and format percent are escaped", () => {
  const text = sql({
    server: "odd$fdw_preflight$'\\server",
    database: "db'\\name",
    remoteSchema: "schema'\\name",
    mappings: [{ localRole: "app%s", remoteUser: "remote'\\user" }],
    importAs: "app%s",
  });
  assert.match(text, /DO \$fdw_preflight_\$/);
  assert.ok(text.includes("dbname E'db''\\\\name'"));
  assert.ok(text.includes("E'remote''\\\\user', mapping_password"));
  assert.ok(text.includes('"app%%s"'));
});
test("FDW rejects duplicate or PUBLIC mappings and any password field", () => {
  for (const mappings of [
    [],
    [
      { localRole: "app", remoteUser: "x" },
      { localRole: "app", remoteUser: "y" },
    ],
    [{ localRole: "PUBLIC", remoteUser: "x" }],
    [{ localRole: "app", remoteUser: "x", password: "do_not_accept" }],
  ])
    assert.throws(() => sql({ mappings }));
  assert.throws(() => sql({ password: "do_not_accept" }));
  assert.throws(() => sql({ importAs: "not_mapped" }));
});
test("FDW rejects invalid ports, SQL-shaped options and conflicting modes", () => {
  for (const port of ["0", "65536", "5432;SELECT 1", "2.5", "-1"])
    assert.throws(() => sql({ port }));
  for (const host of [
    "postgres://user:pass@host",
    "host port=5432",
    "::1]/@evil.invalid",
    "a,b",
    "host\n",
  ]) {
    if (host.endsWith("\n")) assert.throws(() => sql({ host }));
    else assert.throws(() => sql({ host }));
  }
  for (const change of [
    { mode: "invalid" },
    { sslmode: "prefer" },
    { sslmode: "require", sslrootcert: "/root/ca" },
    { importFilter: "all" },
    { tables: "" },
    { mode: "import", columns: [{ localName: "x" }] },
    { mode: "manual", localTable: "x", remoteTable: "x", columns: [] },
    { mode: "server" },
  ])
    assert.throws(() => sql(change));
  assert.throws(() => generate(context, [base, base]));
});
test("FDW manual definitions reject SQL and duplicate columns", () => {
  const manual = {
    mode: "manual",
    importAs: undefined,
    tables: "",
    localTable: "items",
    remoteTable: "items",
  };
  for (const columns of [
    [{ localName: "id", type: "integer); DROP ROLE x;--" }],
    [{ localName: "id", type: "numeric(4,2)" }],
    [{ localName: "id", type: "void" }],
    [
      { localName: "id", type: "integer" },
      { localName: "id", type: "text" },
    ],
    [{ localName: "id", type: "integer", notNull: "yes" }],
  ])
    assert.throws(() => sql({ ...manual, columns }));
});
test("FDW transport and Aurora limitations remain explicit", () => {
  assert.match(sql({ host: "::1" }), /host E'::1'/);
  assert.ok(
    generate(context, [{ ...base, sslmode: "disable" }]).warnings.some((w) =>
      w.includes("DANGER"),
    ),
  );
  assert.ok(
    generate(context, [{ ...base, sslmode: "require" }]).warnings.some((w) =>
      w.includes("does not guarantee hostname"),
    ),
  );
  assert.ok(
    generate({ ...context, platform: "aurora" }, [base]).warnings.some((w) =>
      w.includes("No Aurora runtime test"),
    ),
  );
  assert.doesNotMatch(
    sql(),
    /OPTIONS \(password_required|\nCREATE FOREIGN DATA WRAPPER|\nCREATE ROLE "remote/,
  );
});

test("checked-in SQL examples match the generator and keep only placeholders", async () => {
  const { EXAMPLE_PLANS } = await import("../examples/generate.js");
  const { readFileSync } = await import("node:fs");
  for (const [file, operations] of Object.entries(EXAMPLE_PLANS))
    assert.equal(
      readFileSync(new URL(`../examples/${file}`, import.meta.url), "utf8"),
      generate(context, operations).sql,
    );
});
