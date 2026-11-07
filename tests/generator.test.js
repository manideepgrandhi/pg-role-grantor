import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog, predefined } from "../src/catalog.js";
import { generate, identifier, argumentType } from "../src/generator.js";
const ctx = { platform: "postgres", version: 17 };
const base = {
  kind: "object",
  object: "table",
  targets: "example_schema.example_table",
  privileges: ["SELECT"],
  grantees: "example_app",
};
const sql = (op) => generate(ctx, [op]).sql;
for (const version of [14, 15, 16, 17])
  for (const platform of ["postgres", "aurora"]) {
    test(`${platform} ${version}: every privilege on every object generates GRANT and REVOKE`, () => {
      const entries = catalog(version);
      for (const [object, e] of Object.entries(entries))
        for (const privilege of [...e.privileges, "ALL PRIVILEGES"])
          for (const action of ["grant", "revoke"]) {
            const op = {
              ...base,
              object,
              privileges: [privilege],
              action,
              targets:
                object === "largeobject"
                  ? "12345"
                  : e.qualified
                    ? "example_schema.example_object"
                    : "example_object",
              columns: "a,b",
              argTypes: "integer\ntext[]",
            };
            assert.match(
              generate({ version, platform }, [op]).sql,
              new RegExp(`${action.toUpperCase()} ${privilege}`),
            );
          }
    });
    test(`${platform} ${version}: all legal existing and default scopes`, () => {
      for (const [object, e] of Object.entries(catalog(version))) {
        if (e.all)
          assert.match(
            generate({ version, platform }, [
              {
                ...base,
                object,
                privileges: [e.privileges[0]],
                scope: "all",
                schemas: "s1,s2",
              },
            ]).sql,
            new RegExp(`ALL ${e.all} IN SCHEMA`),
          );
        if (e.defaults)
          for (const action of ["grant", "revoke"])
            assert.match(
              generate({ version, platform }, [
                {
                  ...base,
                  kind: "default",
                  object,
                  privileges: [e.privileges[0]],
                  schemas: object === "schema" ? "" : "s1",
                  creators: "creator",
                  action,
                },
              ]).sql,
              new RegExp(`ON ${e.defaults}`),
            );
      }
    });
    test(`${platform} ${version}: profiles include memberships and future grants`, () => {
      for (const profile of ["reader", "writer", "executor"]) {
        const result = generate({ version, platform }, [
          {
            kind: "profile",
            group: "example_access",
            database: "example_db",
            schemas: "s1,s2",
            creators: "creator1,creator2",
            members: "example_app",
            profile,
          },
        ]);
        assert.match(result.sql, /CREATE ROLE "example_access" NOLOGIN/);
        assert.match(
          result.sql,
          /ALTER DEFAULT PRIVILEGES FOR ROLE "creator1", "creator2" IN SCHEMA "s1", "s2"/,
        );
        assert.match(result.sql, /GRANT "example_access" TO "example_app"/);
        if (profile === "writer") {
          assert.match(result.sql, /GRANT SELECT, INSERT, UPDATE, DELETE/);
          assert.match(result.sql, /GRANT USAGE ON ALL SEQUENCES/);
          assert.doesNotMatch(
            result.sql,
            /GRANT (?:UPDATE ON ALL SEQUENCES|TRUNCATE)/,
          );
        }
        if (version >= 16)
          assert.match(result.sql, /WITH ADMIN FALSE, INHERIT TRUE, SET FALSE/);
      }
    });
  }
test("catalog matches official versioned synopsis evidence", () => {
  const evidence = JSON.parse(
    readFileSync(new URL("../docs/catalog-evidence.json", import.meta.url)),
  );
  for (const version of [14, 15, 16, 17]) {
    const grant = evidence[version]["sql-grant"];
    for (const e of Object.values(catalog(version))) {
      assert.ok(grant.includes(e.keyword));
      for (const p of e.privileges) assert.ok(grant.includes(p));
    }
    const realRoles = evidence[version]["predefined-roles"].filter(
      (n) => n !== "pg_stat_",
    );
    assert.deepEqual(
      predefined(version, "postgres")
        .map((r) => r.name)
        .sort(),
      realRoles,
    );
  }
});
test("version boundaries", () => {
  assert.ok(!catalog(14).parameter);
  assert.ok(catalog(15).parameter);
  assert.ok(!catalog(16).table.privileges.includes("MAINTAIN"));
  assert.ok(catalog(17).table.privileges.includes("MAINTAIN"));
  assert.throws(() =>
    generate({ platform: "postgres", version: 16 }, [
      { ...base, privileges: ["MAINTAIN"] },
    ]),
  );
  assert.throws(() => generate({ ...ctx, version: 18 }, []));
  assert.throws(() => generate({ ...ctx, platform: "fake" }, []));
});
test("identifier and block injection resistance", () => {
  assert.equal(identifier('a"b'), '"a""b"');
  assert.equal(
    identifier("x'; DROP ROLE target; --"),
    '"x\'; DROP ROLE target; --"',
  );
  const attack = "evil$grantor$'\\name";
  const text = sql({ kind: "group", group: attack });
  assert.match(text, /DO \$grantor_\$/);
  assert.match(text, /CREATE ROLE "evil\$grantor\$'\\name"/);
  assert.throws(() => identifier("x\nDROP ROLE x"));
  assert.throws(() => identifier("a".repeat(64)));
  assert.throws(() => identifier("\0"));
  assert.throws(() => identifier(" "));
});
test("strict routine type grammar, overload selection and arrays", () => {
  assert.equal(argumentType("double precision[]"), "double precision[]");
  assert.equal(
    argumentType("example_schema.my_type[][]"),
    '"example_schema"."my_type"[][]',
  );
  assert.match(
    sql({
      ...base,
      object: "procedure",
      privileges: ["EXECUTE"],
      targets: "s.p",
      argTypes: "integer\ntext[]",
    }),
    /ON PROCEDURE "s"\."p"\(integer, text\[\]\)/,
  );
  assert.match(
    sql({
      ...base,
      object: "function",
      privileges: ["EXECUTE"],
      targets: "s.f",
      argTypes: "",
    }),
    /"f"\(\)/,
  );
  for (const x of [
    "integer); DROP ROLE x; --",
    "numeric(10,2)",
    "IN x integer",
    "text /*x*/",
    "text\ninteger",
    '"odd"',
    "a.b.c",
  ])
    assert.throws(() => argumentType(x));
});
test("all privilege, grant option and column forms", () => {
  assert.match(
    sql({ ...base, privileges: ["ALL PRIVILEGES"], grantOption: true }),
    /GRANT ALL PRIVILEGES ON TABLE .* WITH GRANT OPTION;/,
  );
  assert.match(
    sql({
      ...base,
      object: "column",
      columns: "a,b",
      privileges: ["SELECT", "UPDATE"],
    }),
    /SELECT \("a", "b"\), UPDATE \("a", "b"\)/,
  );
  assert.match(
    sql({ ...base, action: "revoke", optionOnly: true, behavior: "CASCADE" }),
    /REVOKE GRANT OPTION FOR SELECT .* CASCADE;/,
  );
  assert.throws(() => sql({ ...base, public: true, grantOption: true }));
  assert.throws(() =>
    sql({ ...base, privileges: ["ALL PRIVILEGES", "SELECT"] }),
  );
  assert.throws(() => sql({ ...base, action: "revoke", grantOption: true }));
  assert.throws(() => sql({ ...base, optionOnly: true }));
});
test("defaults use correct global/schema syntax and warn about PUBLIC", () => {
  const op = {
    kind: "default",
    object: "schema",
    privileges: ["USAGE"],
    creators: "creator",
    grantees: "app",
    schemas: "",
  };
  assert.match(sql(op), /FOR ROLE "creator"\n  GRANT USAGE ON SCHEMAS/);
  assert.throws(() => sql({ ...op, schemas: "s" }));
  assert.throws(() => sql({ ...op, object: "database" }));
  assert.throws(() =>
    sql({ ...op, object: "function", privileges: ["EXECUTE"] }),
  );
  const result = generate(ctx, [
    {
      ...op,
      object: "routine",
      privileges: ["EXECUTE"],
      public: true,
      action: "revoke",
      schemas: "s",
    },
  ]);
  assert.match(result.sql, /ON FUNCTIONS FROM PUBLIC RESTRICT/);
  assert.ok(result.warnings.some((x) => x.includes("cannot remove a global")));
});
test("membership option syntax and built-in boundaries", () => {
  const op = {
    kind: "membership",
    roles: "example_access",
    members: "app",
    admin: false,
    inherit: true,
    set: false,
  };
  assert.match(sql(op), /WITH ADMIN FALSE, INHERIT TRUE, SET FALSE/);
  assert.throws(() => generate({ ...ctx, version: 15 }, [op]));
  assert.match(
    generate({ ...ctx, version: 15 }, [
      { kind: "membership", roles: "reader", members: "app", admin: true },
    ]).sql,
    /WITH ADMIN OPTION/,
  );
  assert.match(
    sql({ ...op, action: "revoke", revokeOption: "SET" }),
    /REVOKE SET OPTION FOR/,
  );
  assert.throws(() => sql({ ...op, roles: "pg_database_owner" }));
  assert.throws(() =>
    generate({ ...ctx, version: 16 }, [{ ...op, roles: "pg_maintain" }]),
  );
  assert.throws(() =>
    generate({ ...ctx, platform: "aurora" }, [
      { ...op, roles: "pg_execute_server_program" },
    ]),
  );
  assert.throws(() => sql({ ...op, roles: "rds_superuser" }));
  assert.throws(() => sql({ ...op, members: "PUBLIC" }));
});
test("invalid objects, scopes, names, OIDs and permissions fail closed", () => {
  for (const change of [
    { object: "unknown" },
    { privileges: ["EXECUTE"] },
    { targets: "" },
    { object: "database", scope: "all" },
    { targets: "a.b.c" },
    { action: "DROP" },
    { action: "revoke", behavior: "INVALID" },
    { object: "column", columns: "" },
  ])
    assert.throws(() => sql({ ...base, ...change }));
  for (const targets of ["0", "4294967296", "123; SELECT 1", "-1", "1.5"])
    assert.throws(() => sql({ ...base, object: "largeobject", targets }));
  assert.match(
    sql({ ...base, object: "largeobject", targets: "4294967295" }),
    /ON LARGE OBJECT 4294967295/,
  );
  assert.throws(() =>
    sql({
      kind: "profile",
      profile: "writer",
      group: "x",
      database: "d",
      schemas: "s",
      creators: "x",
    }),
  );
  assert.throws(() => sql({ kind: "group", group: "pg_reserved" }));
});
test("plan is pure, deterministic, transactional, and does not mutate input", () => {
  const operations = [base, { kind: "group", group: "example_group" }],
    before = JSON.stringify(operations);
  assert.equal(generate(ctx, operations).sql, generate(ctx, operations).sql);
  assert.equal(JSON.stringify(operations), before);
  assert.match(generate(ctx, operations).sql, /BEGIN;[\s\S]+COMMIT;/);
});

test("multiple predefined and custom role arrays preserve SQL, warnings, and deduplication", () => {
  for (const platform of ["postgres", "aurora"])
    for (const version of [14, 15, 16, 17]) {
      const result = generate({ platform, version }, [
        {
          kind: "membership",
          roles: [
            "custom_access",
            "pg_monitor",
            "pg_read_all_settings",
            "pg_monitor",
          ],
          members: ["app", "reporter"],
        },
      ]);
      assert.match(
        result.sql,
        /GRANT "custom_access", "pg_monitor", "pg_read_all_settings" TO "app", "reporter";/,
      );
      assert.ok(result.warnings.some((w) => w.startsWith("pg_monitor:")));
      assert.ok(
        result.warnings.some((w) => w.startsWith("pg_read_all_settings:")),
      );
      assert.doesNotMatch(result.sql, /WITH ADMIN/);
      assert.match(
        generate({ platform, version }, [
          {
            kind: "membership",
            action: "revoke",
            roles: ["pg_monitor", "pg_read_all_settings"],
            members: "app",
          },
        ]).sql,
        /REVOKE "pg_monitor", "pg_read_all_settings" FROM "app" RESTRICT;/,
      );
    }
});
test("role arrays fail closed for empty, unavailable, implicit and AWS-managed choices", () => {
  for (const roles of [
    [],
    ["pg_monitor", "pg_database_owner"],
    ["pg_monitor", "rds_superuser"],
    ["pg_monitor", "aurora_admin"],
  ])
    assert.throws(() => sql({ kind: "membership", roles, members: "app" }));
  assert.throws(() =>
    generate({ platform: "postgres", version: 14 }, [
      {
        kind: "membership",
        roles: ["pg_monitor", "pg_maintain"],
        members: "app",
      },
    ]),
  );
  assert.throws(() =>
    generate({ platform: "aurora", version: 17 }, [
      {
        kind: "membership",
        roles: ["pg_monitor", "pg_execute_server_program"],
        members: "app",
      },
    ]),
  );
});
test("custom role array elements remain quoted identifiers", () => {
  const role = 'custom"; DROP ROLE victim; --';
  assert.ok(
    sql({
      kind: "membership",
      roles: [role, "pg_monitor"],
      members: "app",
    }).includes(
      'GRANT "custom""; DROP ROLE victim; --", "pg_monitor" TO "app";',
    ),
  );
});
