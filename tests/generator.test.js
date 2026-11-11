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
        if (profile !== "executor") {
          const tables =
            profile === "writer"
              ? "SELECT, INSERT, UPDATE, DELETE, TRUNCATE"
              : "SELECT";
          for (const line of [
            `GRANT ${tables} ON ALL TABLES IN SCHEMA "s1", "s2" TO "example_access";`,
            `GRANT ${tables} ON TABLES TO "example_access";`,
            'GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA "s1", "s2" TO "example_access";',
            'GRANT SELECT, USAGE ON SEQUENCES TO "example_access";',
            'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "s1", "s2" TO "example_access";',
            'GRANT EXECUTE ON FUNCTIONS TO "example_access";',
            'GRANT USAGE ON TYPES TO "example_access";',
          ])
            assert.ok(result.sql.includes(line), line);
          assert.doesNotMatch(
            result.sql.replace(/^--.*$/gm, ""),
            /ALL TYPES|ALL ROUTINES|ALL PROCEDURES|UPDATE ON (?:ALL )?SEQUENCES|USAGE, UPDATE|GRANT CREATE ON SCHEMA/,
          );
          assert.equal(result.sql.includes("TRUNCATE"), profile === "writer");
          assert.ok(result.warnings.some((w) => w.includes("nextval")));
          assert.ok(result.warnings.some((w) => w.includes("ALL TYPES")));
        } else {
          assert.match(result.sql, /GRANT EXECUTE ON ALL ROUTINES IN SCHEMA/);
          assert.doesNotMatch(result.sql, /SEQUENCES|TABLES|TYPES/);
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

const profileOp = {
  kind: "profile",
  profile: "reader",
  group: "example_access",
  database: "example_db",
  schemas: "s1",
  creators: "",
  members: "",
};
test("blank creators omit FOR ROLE and warn that only the executing role is covered", () => {
  for (const profile of ["reader", "writer", "executor"]) {
    const result = generate(ctx, [{ ...profileOp, profile }]);
    assert.doesNotMatch(result.sql, /FOR ROLE/);
    assert.match(
      result.sql,
      /ALTER DEFAULT PRIVILEGES IN SCHEMA "s1"\n  GRANT/,
    );
    assert.doesNotMatch(result.sql, /Required role does not exist/);
    assert.ok(result.warnings.some((w) => w.includes("CURRENT_USER")));
  }
  const global = generate(ctx, [
    {
      kind: "default",
      object: "table",
      privileges: ["SELECT"],
      grantees: "app",
      creators: " , ",
      schemas: "",
    },
  ]);
  assert.match(
    global.sql,
    /ALTER DEFAULT PRIVILEGES\n  GRANT SELECT ON TABLES TO "app";/,
  );
  assert.ok(global.warnings.some((w) => w.includes("CURRENT_USER")));
});
test("named creators keep FOR ROLE and role checks", () => {
  const result = generate(ctx, [
    { ...profileOp, creators: "owner_a, owner_b" },
  ]);
  assert.match(
    result.sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE "owner_a", "owner_b" IN SCHEMA "s1"/,
  );
  assert.match(result.sql, /rolname = E'owner_a'\) THEN\n    RAISE EXCEPTION/);
  assert.ok(!result.warnings.some((w) => w.includes("CURRENT_USER")));
  // Required fields stay required.
  for (const change of [{ group: "" }, { database: "" }, { schemas: "" }])
    assert.throws(() => generate(ctx, [{ ...profileOp, ...change }]));
});
test("multi-type grants emit one statement per type with only supported privileges", () => {
  const op = {
    kind: "object",
    objects: ["table", "sequence"],
    scope: "all",
    schemas: "s1",
    privileges: ["SELECT", "USAGE"],
    grantees: "app",
  };
  const text = sql(op);
  assert.ok(
    text.includes(
      'GRANT SELECT ON ALL TABLES IN SCHEMA "s1" TO "app";\nGRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA "s1" TO "app";',
    ),
  );
  assert.doesNotMatch(text, /USAGE ON ALL TABLES/);
  assert.match(
    sql({ ...op, privileges: ["ALL PRIVILEGES"], action: "revoke" }),
    /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "s1" FROM "app" RESTRICT;\nREVOKE ALL PRIVILEGES ON ALL SEQUENCES/,
  );
  assert.match(
    sql({ ...op, scope: "named", targets: "s1.a, s1.b" }),
    /ON TABLE "s1"."a", "s1"."b" TO "app";\nGRANT SELECT, USAGE ON SEQUENCE "s1"."a", "s1"."b"/,
  );
  const defaults = sql({
    ...op,
    kind: "default",
    objects: ["table", "sequence", "routine", "type"],
    privileges: ["SELECT", "USAGE", "EXECUTE"],
    creators: "owner",
  });
  for (const line of [
    "GRANT SELECT ON TABLES",
    "GRANT SELECT, USAGE ON SEQUENCES",
    "GRANT EXECUTE ON FUNCTIONS",
    "GRANT USAGE ON TYPES",
  ])
    assert.ok(defaults.includes(line), line);
  // Legacy single `object` and a single-element `objects` are equivalent.
  assert.equal(
    sql({ ...op, objects: ["table"], privileges: ["SELECT"] }),
    sql({ ...op, objects: undefined, object: "table", privileges: ["SELECT"] }),
  );
});
test("multi-type grants fail closed for empty, unsupported, and incompatible mixes", () => {
  const op = {
    kind: "object",
    objects: ["table", "sequence"],
    scope: "all",
    schemas: "s1",
    privileges: ["SELECT"],
    grantees: "app",
  };
  for (const [change, message] of [
    [
      { privileges: ["USAGE"] },
      /None of the selected permissions apply to Table/,
    ],
    [{ privileges: ["EXECUTE", "SELECT"] }, /EXECUTE is not supported for any/],
    [{ privileges: ["ALL PRIVILEGES", "SELECT"] }, /not both/],
    [{ privileges: [] }, /at least one permission/],
    [{ objects: [] }, /at least one object type/],
    [{ objects: ["table", "column"] }, /needs its own operation/],
    [{ objects: ["table", "largeobject"] }, /needs its own operation/],
    [{ objects: ["table", "parameter"] }, /needs its own operation/],
    [{ objects: ["table", "database"] }, /does not support ALL/],
    [
      { objects: ["table", "function"], scope: "named", targets: "s1.f" },
      /exact overload/,
    ],
    [
      { objects: ["table", "schema"], scope: "named", targets: "s1" },
      /different name formats/,
    ],
    [
      { kind: "default", objects: ["table", "database"], creators: "o" },
      /no default/,
    ],
    [
      {
        kind: "default",
        objects: ["table", "schema"],
        creators: "o",
        privileges: ["USAGE", "SELECT"],
      },
      /must be global/,
    ],
  ])
    assert.throws(() => sql({ ...op, ...change }), message);
  assert.match(
    sql({
      ...op,
      objects: ["function", "procedure"],
      privileges: ["EXECUTE"],
    }),
    /ON ALL FUNCTIONS IN SCHEMA "s1" TO "app";\nGRANT EXECUTE ON ALL PROCEDURES/,
  );
});

// Fixed fixture only; generated passwords never appear in test output.
const loginOp = {
  kind: "group",
  group: "example_login",
  login: true,
  password: "test-pass'word\\x",
};
test("Create role defaults to the unchanged NOLOGIN group", () => {
  for (const op of [
    { kind: "group", group: "example_access" },
    { kind: "group", group: "example_access", login: false },
  ]) {
    const text = sql(op);
    assert.match(
      text,
      /CREATE ROLE "example_access" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;/,
    );
    assert.match(
      text,
      /AND \(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolinherit\)\) THEN\n    RAISE EXCEPTION 'Existing group role has incompatible attributes'/,
    );
    assert.doesNotMatch(text, /PASSWORD|contains a login password/);
  }
});
test("WITH LOGIN creates a login role with an escaped password and never alters an existing one", () => {
  const text = sql(loginOp);
  assert.ok(
    text.includes(
      `CREATE ROLE "example_login" LOGIN PASSWORD E'test-pass''word\\\\x' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;`,
    ),
  );
  // Existing NOLOGIN or elevated roles are rejected, compatible logins are left unchanged.
  assert.match(
    text,
    /AND \(NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolinherit\)\) THEN\n    RAISE EXCEPTION 'Existing login role has incompatible attributes';\n  END IF;/,
  );
  const statements = text.replace(/^--.*\n/gm, "");
  assert.doesNotMatch(statements, /ALTER ROLE|ALTER USER|PASSWORD NULL/);
  assert.equal(text.match(/PASSWORD E'/g).length, 1);
  assert.match(text, /^-- WARNING: This script contains a login password\./m);
  assert.match(text, /Statement logs, client history, and this file itself/);
  assert.match(text, /left unchanged, including its current password/);
});
test("WITH LOGIN keeps the dollar-quote safe when the password contains the tag", () => {
  const text = sql({ ...loginOp, password: "x$grantor$y" });
  assert.match(text, /^DO \$grantor_\$$/m);
  assert.match(text, /^\$grantor_\$;$/m);
  assert.match(text, /PASSWORD E'x\$grantor\$y'/);
});
test("WITH LOGIN rejects empty or control-character passwords and stray passwords", () => {
  for (const password of [undefined, "", "   ", "a\nb", "a\tb", "a\0b", "a\x7fb", 42])
    assert.throws(() => sql({ ...loginOp, password }), /password|control/i);
  assert.throws(
    () => sql({ kind: "group", group: "g", password: "test-pass'word" }),
    /only for Create role WITH LOGIN/,
  );
  assert.throws(
    () => sql({ kind: "group", group: "g", login: false, password: "x" }),
    /only for Create role WITH LOGIN/,
  );
  assert.throws(() => sql({ ...loginOp, login: "true" }), /WITH LOGIN/);
  assert.throws(
    () => sql({ kind: "group", group: "g", login: "yes" }),
    /true or false/,
  );
  assert.throws(() => sql({ ...base, password: "x" }), /WITH LOGIN/);
  assert.throws(
    () =>
      sql({
        kind: "profile",
        profile: "reader",
        group: "g",
        database: "d",
        schemas: "s",
        login: true,
        password: "x",
      }),
    /only available for Create role/,
  );
  assert.throws(() => sql({ ...loginOp, group: "pg_login" }), /non-reserved/);
});
test("generate() does not mutate a WITH LOGIN operation", () => {
  const operations = [{ ...loginOp }, { kind: "group", group: "g" }],
    before = JSON.stringify(operations);
  generate(ctx, operations);
  assert.equal(JSON.stringify(operations), before);
});
