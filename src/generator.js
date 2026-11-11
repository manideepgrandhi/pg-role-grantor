import {
  identifier,
  names,
  qualified,
  argumentType,
  quoted,
  literal,
} from "./sql-input.js";
export { identifier, names, qualified, argumentType } from "./sql-input.js";
import { fdwSetup } from "./fdw.js";
import { catalog, predefined, PLATFORMS, GENERAL_WARNINGS } from "./catalog.js";
const fail = (message) => {
  throw new Error(message);
};
function oneOf(value, values, label) {
  if (!values.includes(value)) fail(`Invalid ${label}.`);
  return value;
}
function grantees(op) {
  return op.public ? "PUBLIC" : quoted(op.grantees);
}
function clauses(op, privileges, target) {
  const action = oneOf(op.action ?? "grant", ["grant", "revoke"], "action");
  if (action === "grant" && op.optionOnly)
    fail("Grant-option-only is a REVOKE option.");
  if (action === "revoke" && op.grantOption)
    fail("WITH GRANT OPTION is a GRANT option.");
  if (op.public && op.grantOption)
    fail("PUBLIC cannot receive a grant option.");
  if (action === "grant")
    return `GRANT ${privileges} ON ${target} TO ${grantees(op)}${op.grantOption ? " WITH GRANT OPTION" : ""};`;
  const behavior = oneOf(
    op.behavior ?? "RESTRICT",
    ["CASCADE", "RESTRICT"],
    "revoke behavior",
  );
  return `REVOKE ${op.optionOnly ? "GRANT OPTION FOR " : ""}${privileges} ON ${target} FROM ${grantees(op)} ${behavior};`;
}
function permissionList(op, entry) {
  const list = op.privileges;
  if (!Array.isArray(list) || !list.length)
    fail("Select at least one permission.");
  for (const p of list)
    if (!entry.privileges.includes(p) && p !== "ALL PRIVILEGES")
      fail(`${p} is not supported for this object and version.`);
  if (list.includes("ALL PRIVILEGES") && list.length !== 1)
    fail("Choose ALL PRIVILEGES or individual permissions, not both.");
  return [...new Set(list)];
}
function grantOne(ctx, op, warnings) {
  const entry = catalog(ctx.version)[op.object];
  if (!entry) fail("Object type is not available in the selected version.");
  const perms = permissionList(op, entry);
  let target;
  if (op.scope === "all") {
    if (!entry.all)
      fail("This object type does not support ALL ... IN SCHEMA.");
    target = `ALL ${entry.all} IN SCHEMA ${quoted(op.schemas)}`;
  } else {
    oneOf(op.scope ?? "named", ["named"], "object scope");
    const objects = names(op.targets);
    if (entry.routine) {
      if (objects.length !== 1)
        fail(
          "Add one routine per operation to specify its overload precisely.",
        );
      const args = String(op.argTypes ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map(argumentType);
      target = `${entry.keyword} ${qualified(objects[0])}(${args.join(", ")})`;
    } else if (op.object === "largeobject") {
      if (
        objects.some((x) => !/^[1-9][0-9]*$/.test(x) || BigInt(x) > 4294967295n)
      )
        fail("Large object OIDs must be integers from 1 to 4294967295.");
      target = `${entry.keyword} ${objects.join(", ")}`;
    } else
      target = `${entry.keyword} ${objects.map(entry.qualified ? qualified : identifier).join(", ")}`;
  }
  let text = perms.join(", ");
  if (op.object === "column") {
    const cols = quoted(op.columns);
    text = perms.map((p) => `${p} (${cols})`).join(", ");
    warnings.push(
      "Column grants do not override table-level grants. Revoking a column privilege does not remove a table-level privilege.",
    );
  }
  if (entry.routine)
    warnings.push(
      "Routines normally have PUBLIC EXECUTE. A SECURITY DEFINER routine may expose more access than table grants. Use exact input argument types to select an overload; omit pure OUT arguments.",
    );
  if (["type", "domain", "language"].includes(op.object))
    warnings.push(
      "PUBLIC may already have USAGE. A direct revoke does not remove access obtained through PUBLIC or another role.",
    );
  if (op.object === "table")
    warnings.push(
      "TABLE syntax also covers views and foreign tables. Actual operations depend on the relation kind, view rules, and foreign server support.",
    );
  if (
    ctx.platform === "aurora" &&
    ["parameter", "tablespace", "fdw", "language"].includes(op.object)
  )
    warnings.push(
      "Aurora manages host-level capabilities. SQL syntax does not imply permission or feature availability. ALTER SYSTEM uses managed parameter groups rather than normal server administration. Check the exact engine release and AWS restrictions.",
    );
  return clauses(op, text, target);
}
function defaultOne(ctx, op, warnings) {
  const entry = catalog(ctx.version)[op.object];
  if (!entry?.defaults)
    fail(
      "Default privileges support only tables, sequences, routines, types, and schemas.",
    );
  const schemas = names(op.schemas, true);
  if (op.object === "schema" && schemas.length)
    fail("Default privileges on schemas must be global, without IN SCHEMA.");
  const creators = names(op.creators, true);
  warnings.push(
    creators.length
      ? "Defaults affect only future objects created by the listed creator roles in this database. Membership does not inherit creator defaults; use SET ROLE during deployment or configure every actual creator."
      : "No creator roles listed: defaults apply only to objects later created by the role that runs this script (CURRENT_USER), not by other owner or creator roles.",
  );
  if (op.action === "revoke" && schemas.length)
    warnings.push(
      "Per-schema REVOKE only undoes per-schema grants. It cannot remove a global default or built-in PUBLIC permission. Use global defaults to remove PUBLIC EXECUTE or TYPE USAGE.",
    );
  if (["routine", "type"].includes(op.object))
    warnings.push(
      "New routines normally grant PUBLIC EXECUTE, and new types grant PUBLIC USAGE. Removing these requires a global default REVOKE per creator and separate revokes on existing objects. Routine defaults include both functions and procedures.",
    );
  return `ALTER DEFAULT PRIVILEGES${creators.length ? ` FOR ROLE ${creators.map(identifier).join(", ")}` : ""}${schemas.length ? ` IN SCHEMA ${schemas.map(identifier).join(", ")}` : ""}\n  ${clauses(op, permissionList(op, entry).join(", "), entry.defaults)}`;
}
// Object types that need their own target fields cannot share one grant form.
export const SINGLE_TYPES = ["column", "largeobject", "parameter"];
// Expands a multi-type grant into one operation per type, keeping only the
// privileges each type supports. A legacy single `object` passes through.
export function splitObjects(ctx, op) {
  const types = op.objects ?? [op.object];
  if (!Array.isArray(types) || !types.length)
    fail("Select at least one object type.");
  const unique = [...new Set(types)];
  if (unique.length === 1) {
    const { objects, ...rest } = op;
    return [{ ...rest, object: unique[0] }];
  }
  const entries = catalog(ctx.version);
  const list = op.privileges;
  if (!Array.isArray(list) || !list.length)
    fail("Select at least one permission.");
  if (list.includes("ALL PRIVILEGES") && list.length !== 1)
    fail("Choose ALL PRIVILEGES or individual permissions, not both.");
  for (const key of unique) {
    const entry = entries[key];
    if (!entry) fail("Object type is not available in the selected version.");
    if (SINGLE_TYPES.includes(key))
      fail(`${entry.label} needs its own operation. Select it alone.`);
    if (op.kind === "default" && !entry.defaults)
      fail(`${entry.label} has no default privileges.`);
    if (op.kind === "object" && op.scope === "all" && !entry.all)
      fail(`${entry.label} does not support ALL ... IN SCHEMA.`);
    if (op.kind === "object" && op.scope !== "all" && entry.routine)
      fail(`${entry.label} needs its own operation to name an exact overload.`);
  }
  if (
    op.kind === "object" &&
    op.scope !== "all" &&
    new Set(unique.map((key) => Boolean(entries[key].qualified))).size > 1
  )
    fail(
      "Named objects of these types use different name formats. Add them as separate operations.",
    );
  for (const p of list)
    if (
      p !== "ALL PRIVILEGES" &&
      !unique.some((key) => entries[key].privileges.includes(p))
    )
      fail(`${p} is not supported for any selected object type.`);
  return unique.map((key) => {
    const privileges = list.includes("ALL PRIVILEGES")
      ? list
      : list.filter((p) => entries[key].privileges.includes(p));
    if (!privileges.length)
      fail(
        `None of the selected permissions apply to ${entries[key].label}. Choose ${entries[key].privileges.join(", ")} or clear that type.`,
      );
    const { objects, ...rest } = op;
    return { ...rest, object: key, privileges };
  });
}
function objectGrant(ctx, op, warnings) {
  return splitObjects(ctx, op)
    .map((part) => grantOne(ctx, part, warnings))
    .join("\n");
}
function defaultGrant(ctx, op, warnings) {
  return splitObjects(ctx, op)
    .map((part) => defaultOne(ctx, part, warnings))
    .join("\n");
}
// Access setup profiles. Executor stays routine-only.
const READ_GRANTS = [
  ["object", "table", ["SELECT"]],
  ["default", "table", ["SELECT"]],
  ["object", "sequence", ["SELECT", "USAGE"]],
  ["default", "sequence", ["SELECT", "USAGE"]],
  ["object", "function", ["EXECUTE"]],
  ["default", "routine", ["EXECUTE"]],
  ["default", "type", ["USAGE"]],
];
export function profileGrants(profile) {
  if (profile === "executor")
    return [
      ["object", "routine", ["EXECUTE"]],
      ["default", "routine", ["EXECUTE"]],
    ];
  if (profile === "reader") return READ_GRANTS;
  const write = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"];
  return READ_GRANTS.map((grant) =>
    grant[1] === "table" ? [grant[0], "table", write] : grant,
  );
}
function roleCheck(name, create) {
  const q = identifier(name),
    l = literal(name);
  const body = `BEGIN\n  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${l}) THEN\n    ${create ? `CREATE ROLE ${q} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;` : "RAISE EXCEPTION 'Required role does not exist';"}\n  ${create ? `ELSIF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${l} AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolinherit)) THEN\n    RAISE EXCEPTION 'Existing group role has incompatible attributes';\n  ` : ""}END IF;\nEND;`;
  let delimiter = "$grantor$";
  while (body.includes(delimiter)) delimiter = delimiter.slice(0, -1) + "_$";
  return `DO ${delimiter}\n${body}\n${delimiter};`;
}
function memberGrant(ctx, op, warnings) {
  const roles = names(op.roles),
    members = names(op.members);
  if (roles.includes("PUBLIC") || members.includes("PUBLIC"))
    fail("PUBLIC cannot be used in role membership.");
  for (const role of roles) {
    const built = predefined(ctx.version, ctx.platform).find(
      (r) => r.name === role,
    );
    if (role.startsWith("pg_") && !built)
      fail("This predefined role is not in the selected version catalog.");
    if (built?.disabled) fail(`${role}: ${built.note}`);
    if (role.startsWith("rds") || role.startsWith("aurora"))
      fail(
        "AWS-managed role assignment is not generated. Review AWS documentation and grant authority.",
      );
    if (built) warnings.push(`${role}: ${built.description} ${built.note}`);
  }
  warnings.push(
    "Memberships apply across the cluster. Existing indirect memberships and grantors can preserve access after a revoke.",
  );
  const rolesSql = roles.map(identifier).join(", "),
    membersSql = members.map(identifier).join(", ");
  const action = oneOf(
    op.action ?? "grant",
    ["grant", "revoke"],
    "membership action",
  );
  if (action === "revoke") {
    const option = oneOf(
      op.revokeOption ?? "",
      ["", "ADMIN", "INHERIT", "SET"],
      "membership revoke option",
    );
    if (ctx.version < 16 && ["INHERIT", "SET"].includes(option))
      fail("Per-membership INHERIT and SET options require PostgreSQL 16+.");
    return `REVOKE ${option ? option + " OPTION FOR " : ""}${rolesSql} FROM ${membersSql} ${oneOf(op.behavior ?? "RESTRICT", ["RESTRICT", "CASCADE"], "revoke behavior")};`;
  }
  if (ctx.version < 16) {
    if (op.inherit !== undefined || op.set !== undefined)
      fail("Per-membership INHERIT and SET options require PostgreSQL 16+.");
    warnings.push(
      "On PostgreSQL 14–15, automatic inheritance depends on the member role INHERIT attribute. SET ROLE is available through membership. Omitted ADMIN preserves an existing admin option.",
    );
    return `GRANT ${rolesSql} TO ${membersSql}${op.admin ? " WITH ADMIN OPTION" : ""};`;
  }
  const opts = [
    ["ADMIN", op.admin],
    ["INHERIT", op.inherit],
    ["SET", op.set],
  ].filter(([, v]) => v !== undefined);
  opts.forEach(([, v]) => {
    if (typeof v !== "boolean")
      fail("Membership options must be true or false.");
  });
  return `GRANT ${rolesSql} TO ${membersSql}${opts.length ? ` WITH ${opts.map(([k, v]) => `${k} ${v ? "TRUE" : "FALSE"}`).join(", ")}` : ""};`;
}
function profile(ctx, op, warnings) {
  oneOf(op.profile, ["reader", "writer", "executor"], "access profile");
  const group = names([op.group])[0];
  if (/^(pg_|rds|aurora)/i.test(group) || group === "PUBLIC")
    fail("Choose a non-reserved group role name.");
  const schemas = names(op.schemas),
    creators = names(op.creators, true),
    members = names(op.members, true);
  if (creators.includes(group) || members.includes(group))
    fail("The access group must differ from creators and members.");
  const statements = [
    roleCheck(group, true),
    ...[...new Set([...creators, ...members])].map((n) => roleCheck(n, false)),
  ];
  const base = { grantees: [group], action: "grant" };
  statements.push(
    grantOne(
      ctx,
      {
        ...base,
        object: "database",
        targets: names(op.database),
        privileges: ["CONNECT"],
      },
      warnings,
    ),
  );
  statements.push(
    grantOne(
      ctx,
      { ...base, object: "schema", targets: schemas, privileges: ["USAGE"] },
      warnings,
    ),
  );
  for (const [kind, object, privileges] of profileGrants(op.profile))
    statements.push(
      kind === "object"
        ? grantOne(
            ctx,
            { ...base, object, privileges, scope: "all", schemas },
            warnings,
          )
        : defaultOne(
            ctx,
            { ...base, object, privileges, schemas, creators },
            warnings,
          ),
    );
  if (op.profile !== "executor")
    warnings.push(
      "Sequence USAGE allows nextval, which increments sequences. EXECUTE on all functions in these schemas includes functions that write data or run as SECURITY DEFINER.",
      "PostgreSQL has no GRANT ... ON ALL TYPES IN SCHEMA. Type USAGE is a future default only; add a named type grant for existing types.",
    );
  if (members.length)
    statements.push(
      memberGrant(
        ctx,
        {
          roles: [group],
          members,
          ...(ctx.version >= 16
            ? { admin: false, inherit: true, set: false }
            : {}),
        },
        warnings,
      ),
    );
  warnings.push(
    "The setup refuses LOGIN or elevated existing group roles. It adds permissions without clearing existing ACLs, ownership, memberships, or default privileges. Creator and member roles must already exist. No passwords or login roles are created.",
  );
  return statements.join("\n\n");
}
export function generate(context, operations) {
  const ctx = { platform: context.platform, version: Number(context.version) };
  oneOf(ctx.platform, PLATFORMS, "platform");
  catalog(ctx.version);
  if (!Array.isArray(operations)) fail("The script plan must be a list.");
  const warnings = [...GENERAL_WARNINGS];
  if (ctx.platform === "aurora")
    warnings.push(
      "Aurora is managed PostgreSQL, not true superuser access. Catalog syntax follows the selected upstream major; confirm engine-release availability. AWS-managed roles, IAM, parameter groups, and host administration are not configured here.",
    );
  const guards = [];
  const fdwServers = new Set();
  const chunks = operations.map((op, index) => {
    oneOf(
      op.kind,
      ["profile", "object", "default", "membership", "group", "fdw"],
      "operation",
    );
    if (op.behavior === "CASCADE")
      warnings.push(
        "CASCADE can remove dependent grants from other users. Review the grant chain before executing.",
      );
    if (op.public)
      warnings.push(
        "PUBLIC means every current and future role. Removing a grant from one user does not override PUBLIC access.",
      );
    if (op.grantOption || op.admin)
      warnings.push(
        "Delegation allows recipients to grant privileges or membership to others.",
      );
    if (op.kind === "fdw") {
      if (fdwServers.has(op.server))
        fail("Use one FDW setup per server name in a plan.");
      fdwServers.add(op.server);
      const fdw = fdwSetup(ctx, op, index + 1);
      guards.push(fdw.guard);
      warnings.push(...fdw.warnings);
      return fdw.sql;
    }
    if (op.kind === "profile") return profile(ctx, op, warnings);
    if (op.kind === "object") return objectGrant(ctx, op, warnings);
    if (op.kind === "default") return defaultGrant(ctx, op, warnings);
    if (op.kind === "membership") return memberGrant(ctx, op, warnings);
    if (/^(pg_|rds|aurora)/i.test(op.group) || op.group === "PUBLIC")
      fail("Choose a non-reserved group role name.");
    return roleCheck(op.group, true);
  });
  const uniqueWarnings = [...new Set(warnings)];
  const header = `-- PG role grantor | ${ctx.platform === "aurora" ? "Aurora PostgreSQL" : "PostgreSQL"} ${ctx.version}\n-- Generated locally. Review permissions, target database, and execution output.\n-- No connection, credentials, or execution is performed by this app.\n`;
  return {
    sql:
      header +
      uniqueWarnings.map((w) => "-- " + w).join("\n") +
      "\n\n" +
      (chunks.length
        ? "BEGIN;\n\n" + [...guards, ...chunks].join("\n\n") + "\n\nCOMMIT;\n"
        : "-- Add an operation to build your script.\n"),
    warnings: uniqueWarnings,
  };
}
