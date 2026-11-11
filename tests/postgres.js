import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { generate, identifier as q } from "../src/generator.js";
import { generateVerification } from "../src/verification.js";
import { catalog } from "../src/catalog.js";
const host = process.env.PGHOST || "/tmp",
  port = process.env.PGPORT || "5544",
  user = process.env.PGUSER || "postgres";
if (!["/tmp", "localhost", "127.0.0.1"].includes(host))
  throw Error(
    "Integration tests only run against a local, disposable PostgreSQL server.",
  );
const tag = `pgg_${process.pid}`,
  db = `${tag}_db`,
  creator = `${tag}_owner`,
  member = `${tag}_app`,
  group = `${tag}_writer`,
  reader = `${tag}_reader`,
  readUser = `${tag}_readuser`,
  receiver = `${tag}_target`;
const roles = [creator, member, group, reader, readUser, receiver],
  ctx = { platform: "postgres", version: 17 };
let verificationChecks = 0;
let count = 0,
  created = false;
function run(sql, database = db, ok = true) {
  const r = spawnSync(
    "psql",
    [
      "-X",
      "-h",
      host,
      "-p",
      port,
      "-U",
      user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (ok && r.status !== 0) throw Error(r.stderr + "\n" + sql);
  if (!ok) {
    assert.notEqual(r.status, 0, "Expected permission failure");
    count++;
  }
  return r.stdout.trim();
}
function check(value, expected = "t") {
  assert.equal(value, expected);
  count++;
}
const grant = (op) => generate(ctx, [op]).sql;
function inspect(operations, context = ctx) {
  return run(
    "BEGIN READ ONLY;" +
      generateVerification(context, operations).sql +
      "ROLLBACK;",
  )
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}
function verify(value, expected = true) {
  assert.deepEqual(value, expected);
  verificationChecks++;
}

try {
  console.log(run("SELECT version();", "postgres"));
  const major = Number(
    run(
      "SELECT current_setting('server_version_num')::int / 10000;",
      "postgres",
    ),
  );
  assert.equal(
    major,
    17,
    "This integration suite verifies PostgreSQL 17 syntax.",
  );
  run(`CREATE DATABASE ${q(db)};`, "postgres");
  created = true;
  run(
    `CREATE ROLE ${q(creator)} NOLOGIN;CREATE ROLE ${q(member)} LOGIN;CREATE ROLE ${q(readUser)} LOGIN;CREATE ROLE ${q(receiver)} NOLOGIN;CREATE SCHEMA s AUTHORIZATION ${q(creator)}; SET ROLE ${q(creator)};CREATE TABLE s.existing (id serial PRIMARY KEY, value text); CREATE FUNCTION s.fn(integer) RETURNS integer LANGUAGE SQL AS 'SELECT $1';CREATE PROCEDURE s.proc(integer) LANGUAGE plpgsql AS 'BEGIN NULL; END;';CREATE TYPE s.mood AS ENUM ('ok'); CREATE DOMAIN s.positive AS integer CHECK(VALUE>0); RESET ROLE;`,
  );
  const setup = {
    kind: "profile",
    profile: "writer",
    group,
    database: db,
    schemas: "s",
    creators: creator,
    members: member,
  };
  verify(
    inspect([setup])
      .flatMap((x) => x.evidence)
      .some((x) => x.status === "MISSING_ROLE"),
  );
  const setupSQL = grant(setup);
  run(setupSQL);
  run(setupSQL);
  const snapshot = () =>
    run(
      "SELECT md5((SELECT string_agg(oid::text||COALESCE(relacl::text,''),',' ORDER BY oid) FROM pg_class)||(SELECT string_agg(oid::text||rolname,',' ORDER BY oid) FROM pg_roles)||COALESCE((SELECT string_agg(oid::text||defaclacl::text,',' ORDER BY oid) FROM pg_default_acl),''));",
    );
  const beforeInspection = snapshot();
  const groupAttributes = inspect([setup])[0].evidence[0];
  verify(
    [
      groupAttributes.rolcanlogin,
      groupAttributes.rolsuper,
      groupAttributes.rolcreatedb,
      groupAttributes.rolcreaterole,
      groupAttributes.rolreplication,
      groupAttributes.rolbypassrls,
      groupAttributes.rolinherit,
    ],
    [false, false, false, false, false, false, true],
  );
  verify(
    inspect([setup])
      .flatMap((x) => x.evidence)
      .every((x) => !String(x.status).startsWith("MISSING")),
  );
  verify(snapshot(), beforeInspection);
  check(
    run(
      `SELECT has_table_privilege('${member}','s.existing','SELECT,INSERT,UPDATE,DELETE');`,
    ),
  );
  run(
    `SET ROLE ${q(member)};INSERT INTO s.existing(value) VALUES ('one'); UPDATE s.existing SET value='two';SELECT * FROM s.existing;DELETE FROM s.existing;RESET ROLE;`,
  );
  count++;
  check(
    run(
      `SELECT has_sequence_privilege('${member}','s.existing_id_seq','USAGE');`,
    ),
  );
  check(
    run(
      `SELECT has_sequence_privilege('${member}','s.existing_id_seq','UPDATE');`,
    ),
    "f",
  );
  run(`SET ROLE ${q(member)};TRUNCATE s.existing;RESET ROLE;`);
  count++;
  run(`SET ROLE ${q(member)};CREATE TABLE s.denied(x int);`, db, false);
  run(
    `SET ROLE ${q(member)};SELECT setval('s.existing_id_seq',100);`,
    db,
    false,
  );
  run(
    `SET ROLE ${q(creator)};CREATE TABLE s.future(id serial,value text);RESET ROLE;`,
  );
  check(run(`SELECT has_table_privilege('${member}','s.future','INSERT');`));
  check(
    run(
      `SELECT has_sequence_privilege('${member}','s.future_id_seq','USAGE');`,
    ),
  );
  run(grant({ ...setup, profile: "reader", group: reader, members: readUser }));
  run(`SET ROLE ${q(readUser)};SELECT * FROM s.future;`, db);
  count++;
  for (const [sqlCheck, expected] of [
    [
      `has_sequence_privilege('${readUser}','s.existing_id_seq','SELECT,USAGE')`,
      "t",
    ],
    [
      `has_sequence_privilege('${readUser}','s.future_id_seq','SELECT,USAGE')`,
      "t",
    ],
    [`has_sequence_privilege('${readUser}','s.existing_id_seq','UPDATE')`, "f"],
    [`has_function_privilege('${reader}','s.fn(integer)','EXECUTE')`, "t"],
    [`has_table_privilege('${readUser}','s.future','TRUNCATE')`, "f"],
    [`has_table_privilege('${member}','s.future','TRUNCATE')`, "t"],
    [`has_schema_privilege('${readUser}','s','CREATE')`, "f"],
  ])
    check(run(`SELECT ${sqlCheck};`), expected);
  run(
    `SET ROLE ${q(creator)};CREATE TYPE s.future_mood AS ENUM ('ok');RESET ROLE;`,
  );
  // Type USAGE is a default only; PUBLIC also has USAGE, so inspect the ACL itself.
  check(
    run(
      `SELECT EXISTS(SELECT 1 FROM pg_type t, aclexplode(t.typacl) a WHERE t.oid='s.future_mood'::regtype AND a.grantee='${reader}'::regrole AND a.privilege_type='USAGE');`,
    ),
  );
  check(
    run(
      `SELECT EXISTS(SELECT 1 FROM pg_type t, aclexplode(t.typacl) a WHERE t.oid='s.mood'::regtype AND a.grantee='${reader}'::regrole);`,
    ),
    "f",
  );
  run(
    `SET ROLE ${q(readUser)};INSERT INTO s.future(value) VALUES('no');`,
    db,
    false,
  );
  check(
    run(
      `SELECT inherit_option AND NOT admin_option AND NOT set_option FROM pg_auth_members WHERE roleid='${group}'::regrole AND member='${member}'::regrole;`,
    ),
  );
  run(
    grant({
      kind: "default",
      object: "routine",
      action: "revoke",
      privileges: ["EXECUTE"],
      creators: creator,
      schemas: "",
      public: true,
    }),
  );
  run(
    grant({
      kind: "default",
      object: "routine",
      privileges: ["EXECUTE"],
      creators: creator,
      schemas: "s",
      grantees: group,
    }),
  );
  run(
    `SET ROLE ${q(creator)};CREATE FUNCTION s.future_fn() RETURNS integer LANGUAGE SQL AS 'SELECT 1';CREATE PROCEDURE s.future_proc() LANGUAGE plpgsql AS 'BEGIN NULL; END;';RESET ROLE;`,
  );
  check(
    run(
      `SELECT has_function_privilege('${member}','s.future_fn()','EXECUTE');`,
    ),
  );
  check(
    run(
      `SELECT has_function_privilege('${member}','s.future_proc()','EXECUTE');`,
    ),
  );
  check(
    run(
      `SELECT has_function_privilege('${receiver}','s.future_fn()','EXECUTE');`,
    ),
    "f",
  );
  // Reader defaults ON FUNCTIONS cover future functions.
  check(
    run(
      `SELECT has_function_privilege('${readUser}','s.future_fn()','EXECUTE');`,
    ),
  );
  // Blank creators: defaults apply to the role that runs the script.
  const ownDefault = {
    kind: "default",
    object: "table",
    creators: "",
    schemas: "s",
    grantees: receiver,
    privileges: ["SELECT"],
  };
  run(`SET ROLE ${q(creator)};${grant(ownDefault)}`);
  run(`SET ROLE ${q(creator)};CREATE TABLE s.own_default(x int);RESET ROLE;`);
  check(
    run(`SELECT has_table_privilege('${receiver}','s.own_default','SELECT');`),
  );
  const ownEvidence = run(
    `SET ROLE ${q(creator)};BEGIN READ ONLY;${generateVerification(ctx, [ownDefault]).sql}ROLLBACK;`,
  )
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .flatMap((x) => x.evidence ?? []);
  verify(
    ownEvidence.some(
      (row) =>
        row.creator === creator && row.explicit_requested_scope_privilege,
    ),
  );
  run(`SET ROLE ${q(creator)};${grant({ ...ownDefault, action: "revoke" })}`);
  // Multi-type grant: one statement per type, privileges filtered per type.
  const multi = {
    kind: "object",
    objects: ["table", "sequence"],
    scope: "all",
    schemas: "s",
    grantees: receiver,
    privileges: ["SELECT", "USAGE"],
  };
  run(grant(multi));
  check(
    run(
      `SELECT has_table_privilege('${receiver}','s.existing','SELECT') AND has_sequence_privilege('${receiver}','s.existing_id_seq','SELECT,USAGE');`,
    ),
  );
  verify(
    inspect([multi])
      .flatMap((x) => x.evidence)
      .every((row) => row.explicit_acl_privilege),
  );
  run(grant({ ...multi, action: "revoke" }));
  check(
    run(
      `SELECT has_table_privilege('${receiver}','s.existing','SELECT') OR has_sequence_privilege('${receiver}','s.existing_id_seq','USAGE');`,
    ),
    "f",
  );
  run(
    "CREATE FUNCTION s.fn(text) RETURNS text LANGUAGE SQL AS 'SELECT $1';CREATE FUNCTION s.never_run(integer) RETURNS integer LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Must not execute target routines'; END;$$;",
  );
  verify(
    inspect([
      {
        kind: "object",
        object: "function",
        targets: "s.fn",
        argTypes: "integer",
        grantees: member,
        privileges: ["EXECUTE"],
      },
    ])[0].evidence.map((row) => row.object_identity),
    ["s.fn(integer)"],
  );
  verify(
    inspect([
      {
        kind: "object",
        object: "function",
        targets: "s.never_run",
        argTypes: "integer",
        grantees: member,
        privileges: ["EXECUTE"],
      },
    ])[0].evidence[0].status,
    "INSPECT_EVIDENCE",
  );
  // Syntax and server acceptance across every current-object grant category.
  run(
    `CREATE FOREIGN DATA WRAPPER example_fdw;CREATE SERVER example_server FOREIGN DATA WRAPPER example_fdw;SELECT lo_create(12345);`,
  );
  const targets = {
    database: db,
    schema: "s",
    table: "s.existing",
    column: "s.existing",
    sequence: "s.existing_id_seq",
    function: "s.fn",
    procedure: "s.proc",
    routine: "s.fn",
    type: "s.mood",
    domain: "s.positive",
    language: "plpgsql",
    fdw: "example_fdw",
    server: "example_server",
    tablespace: "pg_default",
    largeobject: "12345",
    parameter: "work_mem",
  };
  for (const [object, entry] of Object.entries(catalog(17))) {
    const operation = {
      kind: "object",
      object,
      targets: targets[object],
      grantees: receiver,
      privileges: entry.privileges,
      columns: "value",
      argTypes: "integer",
      grantOption: true,
    };
    run(grant(operation));
    count++;
    const granted = inspect([operation])[0].evidence;
    verify(
      granted.every(
        (row) => row.explicit_acl_privilege && row.explicit_acl_grant_option,
      ),
    );
    run(
      grant({
        ...operation,
        grantOption: false,
        action: "revoke",
        optionOnly: true,
      }),
    );
    count++;
    const optionsRemoved = inspect([operation])[0].evidence;
    verify(
      optionsRemoved.every(
        (row) => row.explicit_acl_privilege && !row.explicit_acl_grant_option,
      ),
    );
    run(
      grant({
        ...operation,
        grantOption: false,
        action: "revoke",
        optionOnly: false,
      }),
    );
    count++;
    verify(
      inspect([operation])[0].evidence.every(
        (row) => !row.explicit_acl_privilege,
      ),
    );
    const missing = {
      ...operation,
      targets:
        object === "largeobject"
          ? "4294967294"
          : entry.qualified
            ? "missing_schema.missing_object"
            : "missing_object",
    };
    verify(
      inspect([missing])[0].evidence.every(
        (row) => row.status === "MISSING_OBJECT",
      ),
    );
    verify(
      inspect([
        { ...operation, grantees: "missing_recipient" },
      ])[0].evidence.every(
        (row) =>
          row.status === "MISSING_RECIPIENT" &&
          row.effective_privilege === null,
      ),
    );
    inspect([{ ...operation, public: true, grantOption: false }]);
    verificationChecks++;
    if (entry.all) {
      inspect([{ ...operation, scope: "all", schemas: "s" }]);
      verificationChecks++;
    }
    if (object === "function")
      verify(
        inspect([operation])[0].evidence.every(
          (row) => !row.explicit_acl_privilege && row.effective_privilege,
        ),
      );
  }
  for (const [object, e] of Object.entries(catalog(17)))
    if (e.defaults) {
      const operation = {
        kind: "default",
        object,
        schemas: object === "schema" ? "" : "s",
        creators: creator,
        grantees: receiver,
        privileges: e.privileges,
        grantOption: true,
      };
      run(grant(operation));
      count++;
      verify(
        inspect([operation])[0].evidence.every(
          (row) =>
            row.explicit_requested_scope_privilege &&
            row.explicit_requested_scope_grant_option,
        ),
      );
      run(
        grant({
          ...operation,
          grantOption: false,
          action: "revoke",
          optionOnly: true,
        }),
      );
      count++;
      verify(
        inspect([operation])[0].evidence.every(
          (row) =>
            row.explicit_requested_scope_privilege &&
            !row.explicit_requested_scope_grant_option,
        ),
      );
      run(grant({ ...operation, grantOption: false, action: "revoke" }));
      count++;
      verify(
        inspect([operation])[0].evidence.every(
          (row) => !row.explicit_requested_scope_privilege,
        ),
      );
      inspect([
        { ...operation, schemas: "", public: true, grantOption: false },
      ]);
      verificationChecks++;
      verify(
        inspect([
          { ...operation, creators: "missing_creator" },
        ])[0].evidence.every((row) => row.status === "MISSING_CREATOR"),
      );
      if (object !== "schema")
        verify(
          inspect([
            { ...operation, schemas: "missing_schema" },
          ])[0].evidence.every((row) => row.status === "MISSING_SCHEMA"),
        );
    }
  verify(
    inspect([
      {
        kind: "object",
        object: "parameter",
        targets: "WORK_MEM",
        grantees: receiver,
        privileges: ["SET"],
      },
    ])[0].evidence[0].status,
    "INSPECT_EVIDENCE",
  );
  const globalDefault = {
    kind: "default",
    object: "table",
    creators: creator,
    schemas: "",
    privileges: ["SELECT"],
    grantees: receiver,
  };
  run(grant(globalDefault));
  const scopedRevoke = { ...globalDefault, schemas: "s", action: "revoke" };
  run(grant(scopedRevoke));
  verify(
    inspect([scopedRevoke])[0].evidence.every(
      (row) =>
        !row.explicit_requested_scope_privilege &&
        row.global_or_builtin_privilege &&
        row.combined_exact_recipient_privilege,
    ),
  );
  run(grant({ ...globalDefault, action: "revoke" }));
  verify(
    inspect([
      {
        kind: "default",
        object: "type",
        creators: creator,
        schemas: "s",
        public: true,
        privileges: ["USAGE"],
      },
    ])[0].evidence.every(
      (row) =>
        !row.explicit_requested_scope_privilege &&
        row.global_or_builtin_privilege &&
        row.combined_exact_recipient_privilege,
    ),
  );
  const inheritedOnly = {
    kind: "object",
    object: "table",
    targets: "s.existing",
    grantees: member,
    privileges: ["SELECT"],
  };
  verify(
    inspect([inheritedOnly])[0].evidence.every(
      (row) => !row.explicit_acl_privilege && row.effective_privilege,
    ),
  );
  const unknownSignature = {
    kind: "object",
    object: "function",
    targets: "s.fn",
    argTypes: "missing_schema.missing_type",
    grantees: member,
    privileges: ["EXECUTE"],
  };
  verify(inspect([unknownSignature])[0].evidence[0].status, "MISSING_OBJECT");
  for (const option of ["ADMIN", "INHERIT", "SET"]) {
    run(
      grant({
        kind: "membership",
        roles: group,
        members: receiver,
        admin: true,
        inherit: true,
        set: true,
      }),
    );
    run(
      grant({
        kind: "membership",
        roles: group,
        members: receiver,
        action: "revoke",
        revokeOption: option,
      }),
    );
    count++;
    const membershipRow = inspect([
      {
        kind: "membership",
        roles: group,
        members: receiver,
        action: "revoke",
        revokeOption: option,
      },
    ])[0].evidence[0];
    verify(
      membershipRow.direct_membership &&
        membershipRow[option.toLowerCase() + "_option"] === false,
    );
  }
  run(
    grant({
      kind: "membership",
      roles: group,
      members: receiver,
      action: "revoke",
    }),
  );
  count++;
  // The checkbox UI submits a deduplicated array of custom and predefined roles.
  const multiRoles = [group, "pg_monitor", "pg_read_all_settings"];
  run(
    grant({
      kind: "membership",
      roles: multiRoles,
      members: receiver,
      admin: false,
      inherit: true,
      set: false,
    }),
  );
  verify(
    inspect([
      { kind: "membership", roles: multiRoles, members: receiver },
    ])[0].evidence.every(
      (row) =>
        row.direct_membership &&
        !row.admin_option &&
        row.inherit_option &&
        !row.set_option,
    ),
  );
  for (const role of multiRoles)
    check(run(`SELECT pg_has_role('${receiver}', '${role}', 'MEMBER');`));
  run(
    grant({
      kind: "membership",
      roles: multiRoles,
      members: receiver,
      action: "revoke",
    }),
  );
  for (const role of multiRoles)
    check(run(`SELECT pg_has_role('${receiver}', '${role}', 'MEMBER');`), "f");
  verify(
    inspect([
      { kind: "membership", roles: multiRoles, members: receiver },
    ])[0].evidence.every(
      (row) => !row.direct_membership && !row.direct_or_indirect_member,
    ),
  );
  verify(
    inspect([
      { kind: "membership", roles: group, members: "missing_member" },
    ])[0].evidence[0].status,
    "MISSING_ROLE_OR_MEMBER",
  );
  inspect([{ kind: "membership", roles: group, members: receiver }], {
    platform: "postgres",
    version: 14,
  });
  verificationChecks++;
  console.log(
    `PASS: ${verificationChecks} read-only verification integration checks (before/after ACLs, grant options, defaults, roles, membership, inherited/PUBLIC access, missing resources, overloads, all scopes, unchanged catalog fingerprint).`,
  );
  // No authority to grant a new role: transaction must roll back its created group.
  const rollbackRole = `${tag}_rollback`;
  roles.push(rollbackRole);
  run(
    `SET ROLE ${q(member)};${grant({ ...setup, group: rollbackRole })}`,
    db,
    false,
  );
  check(
    run(`SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='${rollbackRole}');`),
    "f",
  );
  // An existing LOGIN group must be rejected instead of silently repurposed.
  run(grant({ ...setup, group: member, members: receiver }), db, false);
  // Unusual quoted names, SQL-like text, and the DO delimiter remain inert identifiers.
  const odd = `${tag}_x$grantor$'\\";--`;
  roles.push(odd);
  run(grant({ kind: "group", group: odd }));
  count++;
  check(
    run(`SELECT COUNT(*) FROM pg_roles WHERE rolname LIKE '${tag}_%'`),
    String(roles.length - 1),
  );
  console.log(
    `PASS: ${count} PostgreSQL integration checks (including ${Object.keys(catalog(17)).length} object categories).`,
  );
} finally {
  if (created) {
    run(`DROP DATABASE ${q(db)} WITH (FORCE);`, "postgres");
    for (const role of roles)
      run(`DROP ROLE IF EXISTS ${q(role)};`, "postgres");
  }
}
