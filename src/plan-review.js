import { generate } from "./generator.js";
import { names, identifier, argumentType } from "./sql-input.js";
import { catalog } from "./catalog.js";

// Shared expansion for review text and catalog inspection. Setup generation remains authoritative.
export function expandOperation(ctx, op) {
  if (op.kind === "profile") {
    const base = { action: "grant", grantees: [op.group] };
    const schemas = names(op.schemas),
      creators = names(op.creators);
    const grants =
      op.profile === "executor"
        ? [["routine", ["EXECUTE"]]]
        : [
            [
              "table",
              op.profile === "reader"
                ? ["SELECT"]
                : ["SELECT", "INSERT", "UPDATE", "DELETE"],
            ],
            ...(op.profile === "writer" ? [["sequence", ["USAGE"]]] : []),
          ];
    return [
      { kind: "group", group: op.group },
      {
        ...base,
        kind: "object",
        object: "database",
        targets: op.database,
        privileges: ["CONNECT"],
      },
      {
        ...base,
        kind: "object",
        object: "schema",
        targets: schemas,
        privileges: ["USAGE"],
      },
      ...grants.flatMap(([object, privileges]) => [
        { ...base, kind: "object", object, privileges, scope: "all", schemas },
        { ...base, kind: "default", object, privileges, schemas, creators },
      ]),
      ...(names(op.members, true).length
        ? [
            {
              kind: "membership",
              roles: [op.group],
              members: op.members,
              ...(ctx.version >= 16
                ? { admin: false, inherit: true, set: false }
                : {}),
            },
          ]
        : []),
    ];
  }
  if (op.kind === "fdw") {
    op = {
      ...op,
      ...Object.fromEntries(
        [
          "server",
          "localDatabase",
          "host",
          "database",
          "localSchema",
          "remoteSchema",
          "localTable",
          "remoteTable",
          "importAs",
        ]
          .filter((key) => typeof op[key] === "string")
          .map((key) => [key, op[key].trim()]),
      ),
      port: String(Number(op.port)),
      mappings: op.mappings.map((m) => ({
        localRole: m.localRole.trim(),
        remoteUser: m.remoteUser.trim(),
      })),
    };
    const base = {
      kind: "object",
      action: "grant",
      grantees: op.mappings.map((m) => m.localRole),
    };
    const privileges =
      op.access === "writer"
        ? ["SELECT", "INSERT", "UPDATE", "DELETE"]
        : ["SELECT"];
    return [
      op,
      {
        ...base,
        object: "database",
        targets: [op.localDatabase],
        privileges: ["CONNECT"],
      },
      {
        ...base,
        object: "server",
        targets: [op.server],
        privileges: ["USAGE"],
      },
      ...(op.mode === "server"
        ? []
        : [
            {
              ...base,
              object: "schema",
              targets: [op.localSchema],
              privileges: ["USAGE"],
            },
            ...(op.mode === "manual"
              ? [
                  {
                    ...base,
                    object: "table",
                    targets: [`${op.localSchema}.${op.localTable}`],
                    targetParts: [[op.localSchema, op.localTable]],
                    privileges,
                  },
                ]
              : [
                  {
                    ...base,
                    grantees: [op.importAs],
                    object: "schema",
                    targets: [op.localSchema],
                    privileges: ["CREATE"],
                  },
                  {
                    ...base,
                    object: "table",
                    scope: "all",
                    schemas: [op.localSchema],
                    importServer: op.server,
                    privileges,
                  },
                ]),
          ]),
    ];
  }
  return [op];
}
export function describeOperation(ctx, op) {
  const list = (value) => names(value, true).join(", ");
  if (op.kind === "group")
    return `CREATE or reuse compatible NOLOGIN group ${names([op.group])[0]}; NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, INHERIT`;
  if (op.kind === "membership") {
    const action = op.action === "revoke" ? "REVOKE" : "GRANT";
    const options =
      op.action === "revoke"
        ? `${op.revokeOption ? op.revokeOption + " option only; " : ""}${op.behavior || "RESTRICT"}`
        : ctx.version >= 16
          ? ["admin", "inherit", "set"]
              .filter((k) => op[k] !== undefined)
              .map((k) => `${k.toUpperCase()} ${op[k]}`)
              .join(", ") || "options unchanged"
          : `ADMIN ${op.admin ? "granted" : "unchanged"}; inheritance follows member INHERIT; SET ROLE available`;
    return `${action} membership ${list(op.roles)} ${action === "GRANT" ? "to" : "from"} ${list(op.members)} (${options})`;
  }
  if (op.kind === "fdw")
    return `Enable postgres_fdw; create server ${op.server} in local database ${op.localDatabase}; remote ${op.host}:${op.port}/${op.database}, TLS ${op.sslmode || "verify-full"}; ${op.mappings.map((m) => `${m.localRole} → remote user ${m.remoteUser}`).join("; ")}. ${op.mode === "server" ? "Server and mappings only" : op.mode === "manual" ? `Define ${op.localSchema}.${op.localTable} from ${op.remoteSchema}.${op.remoteTable}; columns ${op.columns.map((c) => `${c.localName} ${c.type}${c.notNull ? " NOT NULL" : ""}${c.remoteName ? ` → ${c.remoteName}` : ""}`).join(", ")}` : `Import ${op.remoteSchema} into ${op.localSchema} as ${op.importAs}; ${op.importFilter === "limit" ? "LIMIT TO" : op.importFilter === "exclude" ? "EXCEPT" : "all eligible remote tables"} ${list(op.tables)}`}. Remote authority is not granted locally. Credentials remain private placeholders.`;
  const entry = catalog(ctx.version)[op.object],
    action = op.action === "revoke" ? "REVOKE" : "GRANT";
  const privileges =
    op.privileges.join(", ") +
    (op.kind === "object" && op.object === "column"
      ? ` on columns ${list(op.columns)}`
      : "");
  const target =
    op.kind === "default"
      ? `future ${entry.defaults}; creators ${list(op.creators)}; ${list(op.schemas) ? "schemas " + list(op.schemas) : "database-global"}`
      : op.scope === "all"
        ? `${op.importServer ? "all local foreign tables" : "all existing " + entry.all} in schemas ${list(op.schemas)}${op.importServer ? " on foreign server " + op.importServer : ""}`
        : `${entry.keyword} ${op.targetParts ? op.targetParts.map((parts) => parts.map(identifier).join(".")).join(", ") : list(op.targets)}${
            entry.routine
              ? "(" +
                String(op.argTypes || "")
                  .split("\n")
                  .filter((x) => x.trim())
                  .map(argumentType)
                  .join(", ") +
                ")"
              : ""
          }`;
  return `${action} ${op.optionOnly ? "grant option only for " : ""}${privileges} on ${target} ${action === "GRANT" ? "to" : "from"} ${op.public ? "PUBLIC (every role)" : list(op.grantees)}${op.grantOption ? "; WITH GRANT OPTION" : ""}${action === "REVOKE" ? "; " + (op.behavior || "RESTRICT") : ""}`;
}
export function summarize(ctx, operations) {
  generate(ctx, operations);
  return operations.map((op, index) => {
    const details = expandOperation(ctx, op).map((part) =>
      describeOperation(ctx, part),
    );
    return {
      number: index + 1,
      title:
        op.kind === "profile"
          ? `${op.profile === "writer" ? "Read + write" : op.profile === "reader" ? "Reader" : "Routine executor"} profile → ${op.group}; database ${op.database}; schemas ${names(op.schemas).join(", ")}`
          : details[0],
      details,
    };
  });
}
