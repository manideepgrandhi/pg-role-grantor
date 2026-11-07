import {
  identifier as q,
  literal as l,
  names,
  argumentType,
  doBlock,
} from "./sql-input.js";
const fail = (message) => {
  throw new Error(message);
};
function choice(value, options, label) {
  if (!options.includes(value)) fail(`Invalid FDW ${label}.`);
  return value;
}
function name(value) {
  q(value);
  return value.trim();
}
function option(value, label, max = 1024) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.length > max
  )
    fail(`Enter a valid ${label} without control characters.`);
  return value.trim();
}
function number(value, low, high, label) {
  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < low ||
    Number(value) > high
  )
    fail(`${label} must be an integer from ${low} to ${high}.`);
  return String(Number(value));
}
export function fdwSetup(ctx, op, index) {
  const server = name(op.server),
    localDatabase = name(op.localDatabase);
  const host = option(op.host, "remote hostname", 253);
  let validHost = /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host);
  if (host.includes(":") && /^[A-Fa-f0-9:.]+$/.test(host)) {
    try {
      new URL(`https://[${host}]/`);
      validHost = true;
    } catch {
      validHost = false;
    }
  }
  if (!validHost)
    fail(
      "Use one remote DNS hostname, IPv4 address, or unbracketed IPv6 address. No URI, credentials, host list, or connection string.",
    );
  const database = name(op.database),
    port = number(op.port, 1, 65535, "Remote port");
  const sslmode = choice(
    op.sslmode ?? "verify-full",
    ["verify-full", "require", "disable"],
    "SSL mode",
  );
  const rootcert = op.sslrootcert?.trim()
    ? option(op.sslrootcert, "server-side CA certificate path")
    : "";
  if (rootcert && sslmode !== "verify-full")
    fail("A CA certificate path is offered only with verify-full.");
  const mode = choice(op.mode, ["import", "manual", "server"], "table mode");
  const localSchema = mode === "server" ? "" : name(op.localSchema);
  const access = choice(
    op.access ?? "reader",
    ["reader", "writer"],
    "local access profile",
  );
  if (!Array.isArray(op.mappings) || !op.mappings.length)
    fail("Add at least one explicit local-role to remote-user mapping.");
  const seen = new Set();
  const mappings = op.mappings.map((mapping, i) => {
    if ("password" in mapping)
      fail(
        "Do not pass passwords to the generator. Replace placeholders only in a private SQL file.",
      );
    const localRole = name(mapping.localRole),
      remoteUser = name(mapping.remoteUser);
    if (localRole.toUpperCase() === "PUBLIC")
      fail(
        "PUBLIC user mappings are not generated. Map each execution role explicitly.",
      );
    if (seen.has(localRole))
      fail("Each local role can have only one user mapping per server.");
    seen.add(localRole);
    return {
      localRole,
      remoteUser,
      marker: `__REPLACE_FDW_${index}_MAPPING_${i + 1}_PASSWORD_HEX__`,
    };
  });
  if ("password" in op) fail("Do not pass passwords to the generator.");
  const roles = mappings.map((m) => q(m.localRole)).join(", ");
  const privileges =
    access === "writer" ? "SELECT, INSERT, UPDATE, DELETE" : "SELECT";
  const warnings = [
    "FDW credentials are placeholders only. BEFORE running, replace every full __REPLACE_FDW_*_PASSWORD_HEX__ token in a private SQL file, including its guard occurrence, with the UTF-8 hex encoding of that remote password (hex digits only, not a raw password). The guard aborts the entire plan before mutations until every token is replaced. Never paste credentials into this site. Hex is reversible, not encryption. Protect the finished file and database/client/audit logs; mapping DDL can expose secrets.",
    "FDW mapping is local execution role → existing remote database user, not an IAM role or local membership grant. A member does not inherit a NOLOGIN group user mapping. Direct queries use the current execution identity; SET ROLE changes it. Views and SECURITY DEFINER routines may use another identity. Prefer explicit per-user mappings.",
    "Remote-side checklist (not executed): create/allow the remote LOGIN, allow CONNECT on the remote database, USAGE on its schema, and SELECT on remote tables. Writers also need remote INSERT, UPDATE, DELETE and sequence privileges where remote defaults require them. Local GRANTs never create remote authority.",
    "Network access originates at the local database server, not this browser. Configure DNS, routing, security groups/firewalls, remote authentication, and TLS there. Non-superuser postgres_fdw connections must use supported authentication; this script never sets password_required=false.",
    "FDW setup requires extension-install authority (normally superuser or an allowed managed-service administrator), server-creation authority, user-mapping authority, and local schema/grant authority. It does not grant those administrative powers to application users.",
    "FDW reruns intentionally fail on an existing server, mapping, or foreign table. No existing server or mapping is silently reused or overwritten. CREATE EXTENSION IF NOT EXISTS does not upgrade an installed extension. An existing local schema is reused without changing its owner.",
  ];
  if (sslmode === "verify-full")
    warnings.push(
      "verify-full checks encryption, certificate trust, and hostname. The database server needs a trusted remote CA and a certificate matching the hostname. An optional sslrootcert path refers to a file on that database server, not this computer. Confirm supported trust-store configuration on Aurora.",
    );
  if (sslmode === "require")
    warnings.push(
      "SSL require encrypts traffic but does not guarantee hostname verification. Prefer verify-full with a configured trust root.",
    );
  if (sslmode === "disable")
    warnings.push(
      "DANGER: SSL is disabled. Credentials and data can cross the network unencrypted. Use only for an explicitly isolated local test.",
    );
  if (ctx.platform === "aurora")
    warnings.push(
      "Aurora postgres_fdw availability and extension-install authority depend on the engine release and allowed extension configuration. AWS documents enabling it with appropriate administrative privileges; rds_superuser is not true superuser. Managed filesystem, TLS trust, networking, and remote authentication remain your responsibility. No Aurora runtime test is implied.",
    );
  const guardBody = `DECLARE
  credential_hex text;
BEGIN
  IF current_database() <> ${l(localDatabase)} THEN
    RAISE EXCEPTION 'FDW script is connected to the wrong local database';
  END IF;
${mappings
  .map(
    (m) => `  credential_hex := ${l(m.marker)};
  IF credential_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW password placeholder is unresolved or invalid hex. Replace every full marker with UTF-8 password hex in your private SQL file';
  END IF;
  PERFORM convert_from(decode(credential_hex, 'hex'), 'UTF8');`,
  )
  .join("\n")}
  IF EXISTS (SELECT FROM pg_catalog.pg_foreign_server WHERE srvname = ${l(server)}) THEN
    RAISE EXCEPTION 'FDW server already exists. Existing configuration is not overwritten';
  END IF;
${mappings
  .map(
    (
      m,
    ) => `  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${l(m.localRole)}) THEN
    RAISE EXCEPTION 'An FDW mapped local role does not exist';
  END IF;`,
  )
  .join("\n")}
END;`;
  const sql = [
    `CREATE EXTENSION IF NOT EXISTS postgres_fdw;`,
    `CREATE SERVER ${q(server)}\n  FOREIGN DATA WRAPPER postgres_fdw\n  OPTIONS (host ${l(host)}, port ${l(port)}, dbname ${l(database)},\n    sslmode ${l(sslmode)}, connect_timeout '10'${rootcert ? `, sslrootcert ${l(rootcert)}` : ""});`,
    ...mappings.map((m) =>
      doBlock(
        "fdw_mapping",
        `DECLARE
  mapping_password_hex text := ${l(m.marker)};
  mapping_password text;
BEGIN
  IF mapping_password_hex !~ '^([0-9a-fA-F]{2})+$' THEN
    RAISE EXCEPTION 'FDW mapping password placeholder is unresolved or invalid hex';
  END IF;
  mapping_password := convert_from(decode(mapping_password_hex, 'hex'), 'UTF8');
  EXECUTE format('CREATE USER MAPPING FOR %I SERVER %I OPTIONS (user %L, password %L)',
    ${l(m.localRole)}, ${l(server)}, ${l(m.remoteUser)}, mapping_password);
END;`,
      ),
    ),
    `GRANT CONNECT ON DATABASE ${q(localDatabase)} TO ${roles};`,
    `GRANT USAGE ON FOREIGN SERVER ${q(server)} TO ${roles};`,
  ];
  if (mode === "server") {
    if (
      op.columns?.length ||
      op.localTable ||
      op.remoteTable ||
      op.remoteSchema ||
      op.importAs ||
      names(op.tables, true).length
    )
      fail("Server-only mode cannot include foreign-table or import fields.");
  } else {
    const remoteSchema = name(op.remoteSchema);
    sql.push(
      `CREATE SCHEMA IF NOT EXISTS ${q(localSchema)};`,
      `GRANT USAGE ON SCHEMA ${q(localSchema)} TO ${roles};`,
    );
    if (mode === "manual") {
      if (op.importAs || names(op.tables, true).length)
        fail("Manual mode cannot include import fields.");
      const localTable = name(op.localTable),
        remoteTable = name(op.remoteTable);
      if (!Array.isArray(op.columns) || !op.columns.length)
        fail("Add at least one structured foreign-table column.");
      const columnsSeen = new Set();
      const definitions = op.columns.map((column) => {
        const localName = name(column.localName),
          remoteName = name(column.remoteName || localName);
        if (columnsSeen.has(localName))
          fail("Foreign-table column names must be unique.");
        columnsSeen.add(localName);
        const type = argumentType(column.type);
        if (
          [
            "void",
            "record",
            "anyelement",
            "anyarray",
            "anycompatible",
            "anycompatiblearray",
          ].includes(type)
        )
          fail("Use a concrete table-column data type.");
        if (column.notNull !== undefined && typeof column.notNull !== "boolean")
          fail("NOT NULL must be a boolean.");
        return `  ${q(localName)} ${type}${remoteName !== localName ? ` OPTIONS (column_name ${l(remoteName)})` : ""}${column.notNull ? " NOT NULL" : ""}`;
      });
      sql.push(
        `CREATE FOREIGN TABLE ${q(localSchema)}.${q(localTable)} (\n${definitions.join(",\n")}\n) SERVER ${q(server)}\n  OPTIONS (schema_name ${l(remoteSchema)}, table_name ${l(remoteTable)});`,
        `GRANT ${privileges} ON TABLE ${q(localSchema)}.${q(localTable)} TO ${roles};`,
      );
      warnings.push(
        "Manual foreign-table types, nullability, column names, and collations must match the remote table. This form supports simple concrete types and arrays, not typmods, collations, defaults, constraints, or raw SQL. Prefer IMPORT for complex definitions.",
      );
    } else {
      if (op.columns?.length || op.localTable || op.remoteTable)
        fail("Import mode cannot include manual foreign-table fields.");
      const importAs = name(op.importAs);
      if (!seen.has(importAs))
        fail(
          "The import execution role needs its own explicit mapping in this setup.",
        );
      const filter = choice(
          op.importFilter ?? "all",
          ["all", "limit", "exclude"],
          "import filter",
        ),
        tables = names(op.tables, true);
      if (filter === "all" && tables.length)
        fail("All-table import cannot also contain a LIMIT TO or EXCEPT list.");
      if (filter !== "all" && !tables.length)
        fail("LIMIT TO / EXCEPT requires at least one remote table name.");
      const importSql = `IMPORT FOREIGN SCHEMA ${q(remoteSchema)}${filter === "all" ? "" : ` ${filter === "limit" ? "LIMIT TO" : "EXCEPT"} (${tables.map(q).join(", ")})`}\n  FROM SERVER ${q(server)} INTO ${q(localSchema)}\n  OPTIONS (import_default 'false', import_generated 'false');`;
      sql.push(`GRANT CREATE ON SCHEMA ${q(localSchema)} TO ${q(importAs)};`);
      const body = `DECLARE
  original_role name := current_user;
  foreign_relation record;
BEGIN
  EXECUTE ${l(`SET LOCAL ROLE ${q(importAs)}`)};
  EXECUTE ${l(importSql)};
  FOR foreign_relation IN
    SELECT n.nspname, c.relname FROM pg_catalog.pg_foreign_table f
    JOIN pg_catalog.pg_class c ON c.oid = f.ftrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_foreign_server s ON s.oid = f.ftserver
    WHERE s.srvname = ${l(server)} AND n.nspname = ${l(localSchema)}
  LOOP
    EXECUTE format(${l(`GRANT ${privileges} ON TABLE %I.%I TO ${roles.replaceAll("%", "%%")}`)}, foreign_relation.nspname, foreign_relation.relname);
  END LOOP;
  EXECUTE format('SET LOCAL ROLE %I', original_role);
END;`;
      sql.push(doBlock("fdw_import", body));
      warnings.push(
        "IMPORT connects to the remote database when you execute the SQL. The selected mapped import role needs local schema CREATE and server USAGE and the script executor must be allowed to SET ROLE to it. Imported tables are owned by that role. CREATE is granted to the importer and retained for later imports. The block restores the original execution role. Only foreign tables on the newly created server in this schema receive the generated table grants.",
      );
      warnings.push(
        "IMPORT reads remote definitions. Compatible custom types and collations must already exist locally. Remote defaults and generated expressions are not imported. LIMIT TO / EXCEPT uses remote table names. New remote tables need another reviewed import and local grants; this setup does not create future remote tables or default ACLs.",
      );
    }
  }
  return {
    guard: doBlock("fdw_preflight", guardBody),
    sql: sql.join("\n\n"),
    warnings,
  };
}
