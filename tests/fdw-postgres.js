import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { generate } from "../src/generator.js";
import { literal as l, identifier as q } from "../src/sql-input.js";
const bin =
  process.env.PG_BIN ||
  "/tmp/epg/node_modules/@embedded-postgres/linux-x64/native/bin";
const root = mkdtempSync(join(tmpdir(), "pg-grantor-fdw-")),
  data = join(root, "data");
const port = await new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const secrets = [
  randomBytes(32).toString("hex") + "'\\$fixture$fdw_preflight$$fdw_mapping$",
  randomBytes(32).toString("hex"),
];
let started = false,
  count = 0;
const passwordHex = (secret) => l(Buffer.from(secret, "utf8").toString("hex"));
const clean = (text) =>
  secrets.reduce(
    (text, secret) => text.replaceAll(secret, "[redacted test credential]"),
    String(text),
  );
function command(file, args) {
  const r = spawnSync(file, args, { encoding: "utf8" });
  if (r.status !== 0) throw Error(clean(r.stderr || r.stdout));
  return r.stdout;
}
function run(
  sql,
  { db = "local_db", user = "postgres", fails = false, match } = {},
) {
  const r = spawnSync(
    "psql",
    [
      "-X",
      "-h",
      root,
      "-p",
      String(port),
      "-U",
      user,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (fails) {
    assert.notEqual(r.status, 0, "Expected SQL failure");
    if (match) assert.match(clean(r.stderr), match);
    count++;
  } else if (r.status !== 0) throw Error(clean(r.stderr));
  return r.stdout.trim();
}
function check(a, b = "t") {
  assert.equal(a, b);
  count++;
}
const ctx = { version: 17, platform: "postgres" };
const mappings = [
  { localRole: "local_app", remoteUser: "remote_writer" },
  { localRole: "local_reporter", remoteUser: "remote_reader" },
];
const base = {
  kind: "fdw",
  server: "example_import",
  localDatabase: "local_db",
  host: "127.0.0.1",
  port: String(port),
  database: "remote_db",
  sslmode: "disable",
  localSchema: "imported",
  remoteSchema: "source",
  mappings,
  mode: "import",
  importAs: "local_app",
  importFilter: "all",
  tables: "",
  access: "writer",
};
const script = (op) => generate(ctx, [op]).sql;
function filled(text) {
  return text
    .replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[0]),
    )
    .replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_2_PASSWORD_HEX__'",
      passwordHex(secrets[1]),
    );
}
try {
  command(join(bin, "initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  command(join(bin, "pg_ctl"), [
    "-D",
    data,
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-p ${port} -k ${root} -h 127.0.0.1 -c log_statement=none -c log_min_error_statement=panic`,
    "-w",
    "start",
  ]);
  started = true;
  console.log(run("SELECT version();", { db: "postgres" }));
  run("CREATE DATABASE local_db;", { db: "postgres" });
  run("CREATE DATABASE remote_db;", { db: "postgres" });
  run(
    `CREATE ROLE local_app LOGIN;CREATE ROLE local_reporter LOGIN;CREATE ROLE mapping_group NOLOGIN;CREATE ROLE group_member LOGIN;CREATE ROLE denied_remote LOGIN;CREATE ROLE remote_writer LOGIN PASSWORD ${l(secrets[0])};CREATE ROLE remote_reader LOGIN PASSWORD ${l(secrets[1])};`,
  );
  run(
    `REVOKE CONNECT ON DATABASE remote_db FROM PUBLIC;GRANT CONNECT ON DATABASE remote_db TO remote_writer,remote_reader;CREATE SCHEMA source;REVOKE ALL ON SCHEMA source FROM PUBLIC;CREATE TABLE source.items(id integer PRIMARY KEY,description text);CREATE TABLE source.extra(id integer);INSERT INTO source.items VALUES(1,'original');GRANT USAGE ON SCHEMA source TO remote_writer,remote_reader;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA source TO remote_writer;GRANT SELECT ON ALL TABLES IN SCHEMA source TO remote_reader;`,
    { db: "remote_db" },
  );
  // Both unmapped credentials and a partially edited file must fail without persistent changes.
  run(script(base), { fails: true, match: /placeholder is unresolved/ });
  const combined = generate(ctx, [
    { kind: "group", group: "before_fdw" },
    base,
  ]).sql;
  run(combined, { fails: true, match: /placeholder is unresolved/ });
  check(
    run("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='before_fdw')"),
    "f",
  );

  check(
    run("SELECT EXISTS(SELECT FROM pg_extension WHERE extname='postgres_fdw')"),
    "f",
  );
  for (const [value, match] of [
    ["", /placeholder is unresolved/],
    ["zz", /placeholder is unresolved/],
    ["0", /placeholder is unresolved/],
    ["00", /invalid byte sequence/],
    ["ff", /invalid byte sequence/],
  ]) {
    const invalid = script(base)
      .replaceAll("E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'", l(value))
      .replaceAll(
        "E'__REPLACE_FDW_1_MAPPING_2_PASSWORD_HEX__'",
        passwordHex(secrets[1]),
      );
    run(invalid, { fails: true, match });
  }
  check(
    run(
      "SELECT EXISTS(SELECT FROM pg_foreign_server WHERE srvname='example_import')",
    ),
    "f",
  );
  const partially = script(base)
    .replace(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[0]),
    )
    .replace(
      "E'__REPLACE_FDW_1_MAPPING_2_PASSWORD_HEX__'",
      passwordHex(secrets[1]),
    );
  run(partially, {
    fails: true,
    match: /mapping password placeholder is unresolved/,
  });
  check(
    run(
      "SELECT EXISTS(SELECT FROM pg_foreign_server WHERE srvname='example_import')",
    ),
    "f",
  );
  run(filled(script({ ...base, localDatabase: "wrong_database" })), {
    fails: true,
    match: /wrong local database/,
  });
  run("CREATE SCHEMA imported;CREATE TABLE imported.unrelated(secret text);");
  const applied = run(filled(script(base)) + "SELECT current_user;");
  count++;
  check(applied.split("\n").at(-1), "postgres");
  check(run("SELECT count(*) FROM pg_foreign_table"), "2");
  check(run("SELECT current_user"), "postgres");
  check(
    run(
      "SELECT has_table_privilege('local_app','imported.unrelated','SELECT')",
    ),
    "f",
  );
  check(
    run("SELECT description FROM imported.items WHERE id=1", {
      user: "local_app",
    }),
    "original",
  );
  check(
    run("SELECT description FROM imported.items WHERE id=1", {
      user: "local_reporter",
    }),
    "original",
  );
  run(
    "INSERT INTO imported.items VALUES(2,'written');UPDATE imported.items SET description='updated' WHERE id=2;",
    { user: "local_app" },
  );
  count++;
  check(
    run("SELECT description FROM source.items WHERE id=2", { db: "remote_db" }),
    "updated",
  );
  run("DELETE FROM imported.items WHERE id=2", { user: "local_app" });
  count++;
  check(
    run("SELECT count(*) FROM source.items WHERE id=2", { db: "remote_db" }),
    "0",
  );
  run("INSERT INTO imported.items VALUES(3,'denied')", {
    user: "local_reporter",
    fails: true,
    match: /permission denied/,
  });
  check(
    run("SELECT count(*) FROM source.items WHERE id=3", { db: "remote_db" }),
    "0",
  );
  // Group mapping is not inherited even when group table and server privileges are.
  const groupOp = {
    ...base,
    server: "example_group",
    mode: "manual",
    localSchema: "group_schema",
    localTable: "items",
    remoteTable: "items",
    mappings: [{ localRole: "mapping_group", remoteUser: "remote_reader" }],
    columns: [
      { localName: "id", type: "integer" },
      { localName: "description", type: "text" },
    ],
    importAs: undefined,
    tables: "",
    access: "reader",
  };
  run(
    script(groupOp).replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[1]),
    ),
  );
  count++;
  run("GRANT mapping_group TO group_member WITH INHERIT TRUE,SET TRUE;");
  check(
    run(
      "SELECT has_table_privilege('group_member','group_schema.items','SELECT')",
    ),
  );
  run("SELECT * FROM group_schema.items", {
    user: "group_member",
    fails: true,
    match: /user mapping not found/,
  });
  check(
    run(
      "SET ROLE mapping_group; SELECT description FROM group_schema.items WHERE id=1;",
      { user: "group_member" },
    ),
    "SET\noriginal",
  );
  // Manual writer table uses separate mappings for two actual local login sessions.
  const manual = {
    ...groupOp,
    server: "example_manual",
    localSchema: "manual_schema",
    mappings,
    access: "writer",
  };
  run(filled(script(manual)));
  count++;
  check(
    run("SELECT description FROM manual_schema.items WHERE id=1", {
      user: "local_app",
    }),
    "original",
  );
  check(
    run("SELECT description FROM manual_schema.items WHERE id=1", {
      user: "local_reporter",
    }),
    "original",
  );
  run(
    "INSERT INTO manual_schema.items VALUES(4,'manual');UPDATE manual_schema.items SET description='manual_updated' WHERE id=4;",
    { user: "local_app" },
  );
  count++;
  check(
    run("SELECT description FROM source.items WHERE id=4", { db: "remote_db" }),
    "manual_updated",
  );
  run("DELETE FROM manual_schema.items WHERE id=4", { user: "local_app" });
  count++;
  run("INSERT INTO manual_schema.items VALUES(5,'denied')", {
    user: "local_reporter",
    fails: true,
    match: /permission denied/,
  });
  run(filled(script(manual)), { fails: true, match: /server already exists/ });
  const collision = { ...manual, server: "example_table_collision" };
  run(filled(script(collision)), { fails: true, match: /already exists/ });
  check(
    run(
      "SELECT EXISTS(SELECT FROM pg_foreign_server WHERE srvname='example_table_collision')",
    ),
    "f",
  );
  run(filled(script({ ...base, server: "example_import_collision" })), {
    fails: true,
    match: /already exists/,
  });
  check(
    run(
      "SELECT EXISTS(SELECT FROM pg_foreign_server WHERE srvname='example_import_collision')",
    ),
    "f",
  );

  // Literal escaping and remote column aliases work against real roles and a real database.
  const oddUser = "remote'\\quoted",
    oddDatabase = "remote'\\database";
  run(`CREATE ROLE ${q(oddUser)} LOGIN PASSWORD ${l(secrets[0])};`);
  run(`CREATE DATABASE ${q(oddDatabase)} TEMPLATE remote_db;`, {
    db: "postgres",
  });
  run(
    `GRANT CONNECT ON DATABASE ${q(oddDatabase)} TO ${q(oddUser)};GRANT USAGE ON SCHEMA source TO ${q(oddUser)};GRANT SELECT ON ALL TABLES IN SCHEMA source TO ${q(oddUser)};`,
    { db: oddDatabase },
  );
  const aliased = {
    ...manual,
    server: "server$fdw_mapping$'\\name",
    database: oddDatabase,
    localSchema: "aliased_schema",
    access: "reader",
    mappings: [{ localRole: "local_app", remoteUser: oddUser }],
    columns: [
      { localName: "id", type: "integer" },
      {
        localName: "local_description",
        remoteName: "description",
        type: "text",
      },
    ],
  };
  run(
    script(aliased).replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[0]),
    ),
  );
  count++;
  check(
    run("SELECT local_description FROM aliased_schema.items WHERE id=1", {
      user: "local_app",
    }),
    "original",
  );
  // LIMIT TO and EXCEPT use separate schemas and servers and touch only selected imports.
  for (const [filter, tables, expected] of [
    ["limit", "items", "items"],
    ["exclude", "items", "extra"],
  ]) {
    const op = {
      ...base,
      server: `example_${filter}`,
      localSchema: `schema_${filter}`,
      importFilter: filter,
      tables,
    };
    run(filled(script(op)));
    count++;
    check(
      run(
        `SELECT string_agg(c.relname,',' ORDER BY c.relname) FROM pg_foreign_table f JOIN pg_class c ON c.oid=f.ftrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='schema_${filter}'`,
      ),
      expected,
    );
  }
  // Remote denial is independent from granted local SELECT.
  const denied = {
    ...manual,
    server: "example_denied",
    localSchema: "denied_schema",
    mappings: [{ localRole: "local_app", remoteUser: "denied_remote" }],
    access: "reader",
  };
  run(
    script(denied).replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[0]),
    ),
  );
  count++;
  run("SELECT * FROM denied_schema.items", {
    user: "local_app",
    fails: true,
    match: /password authentication failed/,
  });
  // Dynamic format strings safely handle percent-bearing local identifiers.
  run('CREATE ROLE "percent%role" LOGIN;');
  const percent = {
    ...base,
    server: "example_percent",
    localSchema: "percent_schema",
    mappings: [{ localRole: "percent%role", remoteUser: "remote_reader" }],
    importAs: "percent%role",
    access: "reader",
  };
  run(
    script(percent).replaceAll(
      "E'__REPLACE_FDW_1_MAPPING_1_PASSWORD_HEX__'",
      passwordHex(secrets[1]),
    ),
  );
  count++;
  check(
    run("SELECT description FROM percent_schema.items WHERE id=1", {
      user: "percent%role",
    }),
    "original",
  );
  console.log(
    `PASS: ${count} real FDW integration checks. Fresh isolated local server, loopback SCRAM remote authentication, import/manual read-write, per-user mappings, group-mapping caveat, guards, and collision rollback. Ephemeral credentials never entered source or artifacts; no external databases.`,
  );
} finally {
  if (started)
    command(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
