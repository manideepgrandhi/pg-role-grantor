import { generate } from "./generator.js";
import { expandOperation, describeOperation } from "./plan-review.js";
import { names, argumentType, literal as l } from "./sql-input.js";
import { catalog } from "./catalog.js";
const values = (items) => items.map((value) => `(${l(value)})`).join(", ");
// aclexplode rejects zero-dimensional empty ACL arrays; a null input emits no rows.
const aclRows = (acl) =>
  `pg_catalog.aclexplode(CASE WHEN pg_catalog.array_length(${acl},1)>0 THEN ${acl} END)`;
const wrap = (request, query) =>
  `SELECT pg_catalog.jsonb_build_object('requested', ${l(JSON.stringify(request))}::pg_catalog.jsonb, 'evidence', COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e)), '[]'::pg_catalog.jsonb)) AS inspection\nFROM (\n${query}\n) e;`;
function recipients(op) {
  const items = op.public ? ["PUBLIC"] : names(op.grantees);
  return `recipients AS (SELECT wanted.name AS recipient, ${op.public ? "0::oid" : "r.oid"} AS recipient_oid FROM (VALUES ${values(items)}) wanted(name) LEFT JOIN pg_catalog.pg_roles r ON r.rolname=wanted.name)`;
}
function source(key) {
  const common = (from, id, name, owner, acl, extra = "") => ({
    from,
    id,
    name,
    owner,
    acl,
    extra,
  });
  switch (key) {
    case "table":
    case "sequence":
    case "column":
      return common(
        "pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
        "c.oid",
        "pg_catalog.format('%I.%I', n.nspname,c.relname)",
        "c.relowner",
        "c.relacl",
        key === "sequence"
          ? "c.relkind='S'"
          : "c.relkind IN ('r','p','v','m','f')",
      );
    case "function":
    case "procedure":
    case "routine":
      return common(
        "pg_catalog.pg_proc c JOIN pg_catalog.pg_namespace n ON n.oid=c.pronamespace",
        "c.oid",
        "pg_catalog.format('%I.%I(%s)', n.nspname,c.proname,pg_catalog.pg_get_function_identity_arguments(c.oid))",
        "c.proowner",
        "c.proacl",
        key === "function"
          ? "c.prokind <> 'p'"
          : key === "procedure"
            ? "c.prokind = 'p'"
            : "true",
      );
    case "type":
    case "domain":
      return common(
        "pg_catalog.pg_type c JOIN pg_catalog.pg_namespace n ON n.oid=c.typnamespace",
        "c.oid",
        "pg_catalog.format('%I.%I', n.nspname,c.typname)",
        "c.typowner",
        "c.typacl",
        key === "domain" ? "c.typtype='d'" : "true",
      );
    case "database":
      return common(
        "pg_catalog.pg_database c",
        "c.oid",
        "c.datname",
        "c.datdba",
        "c.datacl",
      );
    case "schema":
      return common(
        "pg_catalog.pg_namespace c",
        "c.oid",
        "c.nspname",
        "c.nspowner",
        "c.nspacl",
      );
    case "language":
      return common(
        "pg_catalog.pg_language c",
        "c.oid",
        "c.lanname",
        "c.lanowner",
        "c.lanacl",
      );
    case "fdw":
      return common(
        "pg_catalog.pg_foreign_data_wrapper c",
        "c.oid",
        "c.fdwname",
        "c.fdwowner",
        "c.fdwacl",
      );
    case "server":
      return common(
        "pg_catalog.pg_foreign_server c",
        "c.oid",
        "c.srvname",
        "c.srvowner",
        "c.srvacl",
      );
    case "tablespace":
      return common(
        "pg_catalog.pg_tablespace c",
        "c.oid",
        "c.spcname",
        "c.spcowner",
        "c.spcacl",
      );
    case "largeobject":
      return common(
        "pg_catalog.pg_largeobject_metadata c",
        "c.oid",
        "c.oid::text",
        "c.lomowner",
        "c.lomacl",
      );
    case "parameter":
      return common(
        "(SELECT name FROM pg_catalog.pg_settings UNION SELECT parname FROM pg_catalog.pg_parameter_acl) setting LEFT JOIN pg_catalog.pg_parameter_acl c ON c.parname=setting.name",
        "COALESCE(c.oid,0::oid)",
        "setting.name",
        "0::oid",
        "c.paracl",
      );
  }
}
function objects(ctx, op) {
  const entry = catalog(ctx.version)[op.object],
    s = source(op.object);
  const routine = entry.routine;
  const nameColumn = ["table", "column", "sequence"].includes(op.object)
    ? "c.relname"
    : routine
      ? "c.proname"
      : ["type", "domain"].includes(op.object)
        ? "c.typname"
        : s.name;
  const visibility = routine
    ? "pg_function_is_visible"
    : ["type", "domain"].includes(op.object)
      ? "pg_type_is_visible"
      : "pg_table_is_visible";
  const constraints = s.extra ? [s.extra] : [];
  if (routine && op.scope !== "all") {
    const args = String(op.argTypes || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(argumentType);
    constraints.push(
      `c.pronargs=${args.length}`,
      ...args.map(
        (type, i) =>
          `c.proargtypes[${i}]=pg_catalog.to_regtype(${l(type)})::oid`,
      ),
    );
  }
  const selects = (
    op.scope === "all" ? names(op.schemas) : names(op.targets)
  ).map((target, index) => {
    let where;
    if (op.scope === "all") where = `n.nspname=${l(target)}`;
    else if (entry.qualified) {
      const parts = op.targetParts?.[index] || target.split(".");
      where = `${nameColumn}=${l(parts.at(-1))} AND ${parts.length === 2 ? `n.nspname=${l(parts[0])}` : `pg_catalog.${visibility}(c.oid)`}`;
    } else
      where =
        op.object === "parameter"
          ? `pg_catalog.lower(${nameColumn})=pg_catalog.lower(${l(target)})`
          : `${nameColumn}=${l(target)}`;
    if (op.importServer)
      where += ` AND EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_table ft JOIN pg_catalog.pg_foreign_server fs ON fs.oid=ft.ftserver WHERE ft.ftrelid=c.oid AND fs.srvname=${l(op.importServer)})`;
    return `SELECT ${l(target)}::text AS requested_target, o.* FROM (VALUES (1)) anchor(x) LEFT JOIN LATERAL (SELECT ${s.id} AS object_oid, ${s.name}::text AS object_identity, ${s.owner} AS owner_oid, ${s.acl} AS acl FROM ${s.from} WHERE ${[where, ...constraints].join(" AND ")}) o ON true`;
  });
  let query = selects.join("\nUNION ALL\n");
  if (op.object === "column")
    query = `SELECT t.requested_target,t.object_oid,t.object_identity,t.owner_oid,a.attacl AS acl,col.name AS requested_column,a.attnum FROM (${query}) t CROSS JOIN (VALUES ${values(names(op.columns))}) col(name) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=t.object_oid AND a.attname=col.name AND a.attnum>0 AND NOT a.attisdropped`;
  return query;
}
function objectEvidence(ctx, op) {
  const entry = catalog(ctx.version)[op.object];
  const privileges = op.privileges.includes("ALL PRIVILEGES")
    ? entry.privileges
    : op.privileges;
  const funcs = {
    table: "table",
    column: "column",
    sequence: "sequence",
    function: "function",
    procedure: "function",
    routine: "function",
    type: "type",
    domain: "type",
    database: "database",
    schema: "schema",
    language: "language",
    fdw: "foreign_data_wrapper",
    server: "server",
    tablespace: "tablespace",
    largeobject: "largeobject",
    parameter: "parameter",
  };
  const effective = (grantOption) => {
    // PostgreSQL has no has_largeobject_privilege function. Inspect ACLs, not object contents.
    if (op.object === "largeobject") return "NULL::boolean";
    const args = `${op.object === "parameter" ? "o.object_identity" : "o.object_oid"}${op.object === "column" ? ", o.attnum" : ""}, p.permission${grantOption ? " || ' WITH GRANT OPTION'" : ""}`;
    const fn = `pg_catalog.has_${funcs[op.object]}_privilege`;
    return `CASE WHEN o.object_oid IS NULL OR r.recipient_oid IS NULL${op.object === "column" ? " OR o.attnum IS NULL" : ""} THEN NULL ELSE ${fn}(${op.public ? "'public'::name" : "r.recipient_oid"}, ${args}) END`;
  };
  const direct = (option) =>
    `EXISTS (SELECT 1 FROM ${aclRows("o.acl")} a WHERE a.grantee=r.recipient_oid AND a.privilege_type=p.permission${option ? " AND a.is_grantable" : ""})`;
  return `WITH ${recipients(op)}, objects AS (${objects(ctx, op)})
SELECT r.recipient, r.recipient_oid, o.requested_target, o.object_identity, ${op.object === "column" ? "o.requested_column, o.attnum, " : ""}p.permission,
 CASE WHEN r.recipient_oid IS NULL THEN 'MISSING_RECIPIENT' WHEN o.object_oid IS NULL THEN ${l(op.scope === "all" ? "NO_MATCHING_OBJECTS_OR_MISSING_SCHEMA" : "MISSING_OBJECT")}${op.object === "column" ? " WHEN o.attnum IS NULL THEN 'MISSING_COLUMN'" : ""} ELSE 'INSPECT_EVIDENCE' END AS status,
 ${direct(false)} AS explicit_acl_privilege, ${direct(true)} AS explicit_acl_grant_option,
 ${effective(false)} AS effective_privilege, ${effective(true)} AS effective_grant_option
FROM recipients r CROSS JOIN objects o CROSS JOIN (VALUES ${values(privileges)}) p(permission)`;
}
function defaultEvidence(ctx, op) {
  const codes = {
    table: ["r", "r"],
    sequence: ["S", "s"],
    routine: ["f", "f"],
    type: ["T", "T"],
    schema: ["n", "n"],
  };
  const [code, baseline] = codes[op.object];
  const schemas = names(op.schemas, true);
  const perms = op.privileges.includes("ALL PRIVILEGES")
    ? catalog(ctx.version)[op.object].privileges
    : op.privileges;
  const has = (acl, option = false) =>
    `EXISTS (SELECT 1 FROM ${aclRows(acl)} a WHERE a.grantee=r.recipient_oid AND a.privilege_type=p.permission${option ? " AND a.is_grantable" : ""})`;
  const global = `COALESCE(g.defaclacl,pg_catalog.acldefault('${baseline}',creator.oid))`;
  return `WITH ${recipients(op)}
SELECT wanted.name AS creator, r.recipient, scope.name AS requested_schema, CASE WHEN scope.name='' THEN NULL ELSE n.oid IS NOT NULL END AS schema_exists, CASE WHEN scope.name='' THEN 'DATABASE_GLOBAL' ELSE 'SCHEMA' END AS scope_kind,
 CASE WHEN creator.oid IS NULL THEN 'MISSING_CREATOR' WHEN r.recipient_oid IS NULL THEN 'MISSING_RECIPIENT' WHEN scope.name<>'' AND n.oid IS NULL THEN 'MISSING_SCHEMA' ELSE 'INSPECT_CONFIGURED_DEFAULTS' END AS status,
 g.oid IS NOT NULL AS explicit_global_row, d.oid IS NOT NULL AS explicit_schema_row,
 p.permission, ${has(schemas.length ? "d.defaclacl" : "g.defaclacl")} AS explicit_requested_scope_privilege,
 ${has(schemas.length ? "d.defaclacl" : "g.defaclacl", true)} AS explicit_requested_scope_grant_option,
 ${has(global)} AS global_or_builtin_privilege, ${has(global, true)} AS global_or_builtin_grant_option,
 (${has(global)} OR ${has("d.defaclacl")}) AS combined_exact_recipient_privilege,
 (${has(global, true)} OR ${has("d.defaclacl", true)}) AS combined_exact_recipient_grant_option
FROM (VALUES ${values(names(op.creators))}) wanted(name)
LEFT JOIN pg_catalog.pg_roles creator ON creator.rolname=wanted.name
CROSS JOIN recipients r CROSS JOIN (VALUES ${values(schemas.length ? schemas : [""])}) scope(name)
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=scope.name
LEFT JOIN pg_catalog.pg_default_acl g ON g.defaclrole=creator.oid AND g.defaclnamespace=0 AND g.defaclobjtype='${code}'
LEFT JOIN pg_catalog.pg_default_acl d ON d.defaclrole=creator.oid AND d.defaclnamespace=n.oid AND d.defaclobjtype='${code}'
CROSS JOIN (VALUES ${values(perms)}) p(permission)`;
}
function membershipEvidence(ctx, op) {
  return `SELECT wanted_role.name AS granted_role, wanted_member.name AS member,
 CASE WHEN role.oid IS NULL OR member.oid IS NULL THEN 'MISSING_ROLE_OR_MEMBER' ELSE 'INSPECT_MEMBERSHIP' END AS status,
 a.roleid IS NOT NULL AS direct_membership, grantor.rolname AS grantor, a.admin_option,
 ${ctx.version >= 16 ? "a.inherit_option, a.set_option" : "member.rolinherit AS member_role_inherit"},
 CASE WHEN role.oid IS NOT NULL AND member.oid IS NOT NULL THEN pg_catalog.pg_has_role(member.oid,role.oid,'MEMBER') END AS direct_or_indirect_member,
 CASE WHEN role.oid IS NOT NULL AND member.oid IS NOT NULL THEN pg_catalog.pg_has_role(member.oid,role.oid,'USAGE') END AS immediate_role_usage
FROM (VALUES ${values(names(op.roles))}) wanted_role(name) CROSS JOIN (VALUES ${values(names(op.members))}) wanted_member(name)
LEFT JOIN pg_catalog.pg_roles role ON role.rolname=wanted_role.name
LEFT JOIN pg_catalog.pg_roles member ON member.rolname=wanted_member.name
LEFT JOIN pg_catalog.pg_auth_members a ON a.roleid=role.oid AND a.member=member.oid
LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=a.grantor`;
}
function groupEvidence(op) {
  return `SELECT wanted.name AS role_name, CASE WHEN r.oid IS NULL THEN 'MISSING_ROLE' ELSE 'INSPECT_ROLE_ATTRIBUTES' END AS status,
 r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit
FROM (VALUES (${l(names([op.group])[0])})) wanted(name) LEFT JOIN pg_catalog.pg_roles r ON r.rolname=wanted.name`;
}
function fdwEvidence(op) {
  const tables =
    op.mode === "server"
      ? ""
      : `, 'foreign_tables',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'table',c.relname,'owner',owner.rolname,'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('column',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))) FROM pg_catalog.pg_foreign_table ft JOIN pg_catalog.pg_class c ON c.oid=ft.ftrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_roles owner ON owner.oid=c.relowner WHERE ft.ftserver=s.oid AND n.nspname=${l(op.localSchema)}${op.mode === "manual" ? ` AND c.relname=${l(op.localTable)}` : ""}),'[]'::pg_catalog.jsonb)`;
  return `SELECT pg_catalog.jsonb_build_object('extension_installed',EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='postgres_fdw'),
 'server_exists',s.oid IS NOT NULL,'wrapper',w.fdwname,
 'mappings',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('local_role',wanted.name,'role_exists',r.oid IS NOT NULL,'mapping_exists',m.umid IS NOT NULL)) FROM (VALUES ${values(op.mappings.map((m) => m.localRole))}) wanted(name) LEFT JOIN pg_catalog.pg_roles r ON r.rolname=wanted.name LEFT JOIN pg_catalog.pg_user_mappings m ON m.umuser=r.oid AND m.srvid=s.oid),'[]'::pg_catalog.jsonb)${tables}) AS local_fdw_evidence
FROM (VALUES (1)) anchor(x) LEFT JOIN pg_catalog.pg_foreign_server s ON s.srvname=${l(op.server)} LEFT JOIN pg_catalog.pg_foreign_data_wrapper w ON w.oid=s.srvfdw`;
}
export function generateVerification(ctx, operations) {
  generate(ctx, operations);
  const blocks = [];
  operations.forEach((original, index) =>
    expandOperation(ctx, original).forEach((op) => {
      const query =
        op.kind === "group"
          ? groupEvidence(op)
          : op.kind === "membership"
            ? membershipEvidence(ctx, op)
            : op.kind === "default"
              ? defaultEvidence(ctx, op)
              : op.kind === "fdw"
                ? fdwEvidence(op)
                : objectEvidence(ctx, op);
      blocks.push(
        `-- Operation ${index + 1}: ${describeOperation(ctx, op).replace(/[\r\n]/g, " ")}\n${wrap({ kind: op.kind, object: op.object || null, action: op.action || "grant", description: describeOperation(ctx, op) }, query)}`,
      );
    }),
  );
  return {
    sql: `-- PG role grantor | READ-ONLY verification inspection | ${ctx.platform} ${ctx.version}
-- Run yourself after setup, in the intended database with the same search_path and matching major version.
-- SELECT catalog evidence only. This script does not execute user routines or query foreign data.
-- Requested operations remain in original order, not a predicted final state. Later operations can supersede earlier ones.
-- No PASS verdicts: compare requested intent with explicit ACLs, grant options, and separately effective access.
-- NULL effective access means unavailable/not evaluated (including large objects); false explicit ACL does not deny inherited/PUBLIC/owner access.
-- Default ACLs report configuration per creator: global or built-in defaults plus additive schema entries for the exact recipient, not future-object execution tests.
-- Catalog access/visibility can limit evidence. Empty schema inventories do not prove remote/import completeness.
-- FDW mappings report presence only: remote usernames, credentials, connection options, TLS, remote rights and column mappings are NOT inspected.
-- CASCADE impacts on unrelated grantees, RLS, SECURITY DEFINER behavior, and remote authorization are not audited.
\nSELECT pg_catalog.current_database() AS connected_database, CURRENT_USER AS inspecting_role,
 ${Number(ctx.version)} AS expected_major, pg_catalog.current_setting('server_version_num')::integer / 10000 AS actual_major;\n\n${blocks.join("\n\n")}\n`,
  };
}
