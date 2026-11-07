export const VERSIONS = [14, 15, 16, 17];
export const PLATFORMS = ["postgres", "aurora"];
const table = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];
const object = (label, keyword, privileges, extra = {}) => ({
  label,
  keyword,
  privileges,
  ...extra,
});
export function catalog(version) {
  if (!VERSIONS.includes(Number(version)))
    throw new Error("Select a supported major version (14–17).");
  return {
    database: object("Database", "DATABASE", [
      "CONNECT",
      "CREATE",
      "TEMPORARY",
    ]),
    schema: object("Schema", "SCHEMA", ["USAGE", "CREATE"], {
      defaults: "SCHEMAS",
    }),
    table: object(
      "Table / view / foreign table",
      "TABLE",
      [...table, ...(version >= 17 ? ["MAINTAIN"] : [])],
      { qualified: true, all: "TABLES", defaults: "TABLES" },
    ),
    column: object(
      "Table columns",
      "TABLE",
      ["SELECT", "INSERT", "UPDATE", "REFERENCES"],
      { qualified: true },
    ),
    sequence: object("Sequence", "SEQUENCE", ["USAGE", "SELECT", "UPDATE"], {
      qualified: true,
      all: "SEQUENCES",
      defaults: "SEQUENCES",
    }),
    function: object("Function", "FUNCTION", ["EXECUTE"], {
      qualified: true,
      routine: true,
      all: "FUNCTIONS",
    }),
    procedure: object("Procedure", "PROCEDURE", ["EXECUTE"], {
      qualified: true,
      routine: true,
      all: "PROCEDURES",
    }),
    routine: object("All routine kinds", "ROUTINE", ["EXECUTE"], {
      qualified: true,
      routine: true,
      all: "ROUTINES",
      defaults: "FUNCTIONS",
    }),
    type: object("Type (including domains)", "TYPE", ["USAGE"], {
      qualified: true,
      defaults: "TYPES",
    }),
    domain: object("Domain", "DOMAIN", ["USAGE"], { qualified: true }),
    language: object("Procedural language", "LANGUAGE", ["USAGE"]),
    fdw: object("Foreign data wrapper", "FOREIGN DATA WRAPPER", ["USAGE"]),
    server: object("Foreign server", "FOREIGN SERVER", ["USAGE"]),
    tablespace: object("Tablespace", "TABLESPACE", ["CREATE"]),
    largeobject: object("Large object", "LARGE OBJECT", ["SELECT", "UPDATE"]),
    ...(version >= 15
      ? {
          parameter: object("Configuration parameter", "PARAMETER", [
            "SET",
            "ALTER SYSTEM",
          ]),
        }
      : {}),
  };
}
const builtins = [
  [
    "pg_read_all_data",
    14,
    "Reads all data and sequences across schemas. RLS still applies.",
  ],
  [
    "pg_write_all_data",
    14,
    "Writes all data across schemas. Does not include SELECT. RLS still applies.",
  ],
  [
    "pg_monitor",
    14,
    "Monitoring views and functions, including settings and statistics.",
  ],
  [
    "pg_read_all_settings",
    14,
    "Reads settings normally restricted to superusers.",
  ],
  [
    "pg_read_all_stats",
    14,
    "Reads statistics normally restricted to superusers.",
  ],
  [
    "pg_stat_scan_tables",
    14,
    "Runs monitoring functions that can take long-lived locks.",
  ],
  ["pg_signal_backend", 14, "Cancels or terminates non-superuser sessions."],
  [
    "pg_read_server_files",
    14,
    "Reads server files. Can bypass database permission boundaries.",
    true,
  ],
  [
    "pg_write_server_files",
    14,
    "Writes server files. Can bypass database permission boundaries.",
    true,
  ],
  [
    "pg_execute_server_program",
    14,
    "Runs operating-system programs as the database server user.",
    true,
  ],
  ["pg_checkpoint", 15, "Runs CHECKPOINT."],
  ["pg_use_reserved_connections", 16, "Uses reserved connection slots."],
  [
    "pg_create_subscription",
    16,
    "Creates subscriptions with database CREATE permission.",
  ],
  ["pg_maintain", 17, "Maintenance rights on all relations."],
  [
    "pg_database_owner",
    14,
    "Implicit current database owner. Membership cannot be granted.",
    false,
    true,
  ],
];
export function predefined(version, platform) {
  catalog(version);
  return builtins
    .filter(([, min]) => version >= min)
    .map(([name, min, description, hostOnly, implicit]) => ({
      name,
      description,
      min,
      disabled: Boolean(implicit || (platform === "aurora" && hostOnly)),
      note: implicit
        ? "Implicit membership only."
        : platform === "aurora"
          ? hostOnly
            ? "Host access unavailable on Aurora."
            : "Confirm availability and grant authority on your exact Aurora engine release."
          : "",
    }));
}
export const GENERAL_WARNINGS = [
  "Review before running. This app does not connect to a database or verify your grant authority. PostgreSQL can warn and apply only a subset of requested grants; inspect execution output and resulting ACLs.",
  "Roles and memberships are cluster-wide. Object grants and default privileges apply in the connected database. Run each database-specific script in the correct database.",
  "Access is additive through direct grants, membership, PUBLIC, ownership, and security-definer routines. Reader does not guarantee read-only access. RLS remains unchanged.",
];
