import { field, select, check } from "./form-fields.js";
const $ = (id) => document.getElementById(id);
let nextMapping = 0,
  nextColumn = 0;
function mappingRow(
  localRole = "example_app",
  remoteUser = "example_remote_reader",
) {
  const id = ++nextMapping,
    row = document.createElement("div");
  row.className = "fdw-row mapping-row";
  row.innerHTML = `<div class="field-grid">${field(`mapping-${id}-local`, "Local execution role", localRole)}${field(`mapping-${id}-remote`, "Remote database user", remoteUser)}</div><button type="button" class="text-button remove-row" aria-label="Remove role mapping ${id}">Remove mapping</button>`;
  row.dataset.row = id;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("mapping-rows").append(row);
}
function columnRow(localName = "id", type = "integer", remoteName = "") {
  const id = ++nextColumn,
    row = document.createElement("div");
  row.className = "fdw-row column-row";
  row.dataset.row = id;
  row.innerHTML = `<div class="field-grid">${field(`column-${id}-name`, "Local column name", localName)}${field(`column-${id}-type`, "Column data type", type, "Simple concrete types, custom schema.type, or [] arrays. No typmods or SQL.")}${field(`column-${id}-remote`, "Remote column (blank = same)", remoteName)}</div>${check(`column-${id}-notnull`, "NOT NULL matches remote column")}<button type="button" class="text-button remove-row" aria-label="Remove column ${id}">Remove column</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("column-rows").append(row);
}
function tableFields() {
  const mode = $("mode").value;
  $("fdw-tables").innerHTML =
    mode === "server"
      ? '<p class="description">Server and role mappings only. No local schema or foreign tables are created. Add reviewed table definitions and grants before querying.</p>'
      : `<div class="field-grid">${field("localSchema", "Local schema", "example_foreign")}${field("remoteSchema", "Remote schema", "example_remote")}</div>` +
        (mode === "import"
          ? `${field("importAs", "Import as local mapped role", "example_importer", "Must be listed above. Executor needs SET ROLE authority. Importer receives schema CREATE and owns imported tables.")}${select(
              "importFilter",
              "Import selection",
              [
                ["all", "All eligible remote tables"],
                ["limit", "LIMIT TO named tables"],
                ["exclude", "EXCEPT named tables"],
              ],
              "limit",
            )}<div id="import-list"></div><p class="hint">IMPORT connects only when you execute the SQL in your database. Types and collations must exist locally. Defaults and generated expressions are not imported.</p>`
          : `<div class="field-grid">${field("localTable", "Local foreign-table name", "example_items")}${field("remoteTable", "Remote table name", "example_items")}</div><div class="subheading"><h3>Structured columns</h3><button type="button" class="text-button" id="add-column">+ Add column</button></div><div id="column-rows"></div><p class="hint">Match remote types and nullability exactly. Prefer import for complex types, modifiers, or collations.</p>`);
  if (mode === "import") {
    const renderList = () => {
      $("import-list").innerHTML =
        $("importFilter").value === "all"
          ? ""
          : field(
              "tables",
              "Remote table names",
              "example_items",
              "Comma-separated or one per line, without schema prefixes or SQL quotes.",
            );
    };
    $("importFilter").addEventListener("change", renderList);
    renderList();
  } else if (mode === "manual") {
    $("add-column").addEventListener("click", () =>
      columnRow("example_column", "text"),
    );
    columnRow();
    columnRow("description", "text");
  }
}
export function renderFdwForm(panel) {
  nextMapping = 0;
  nextColumn = 0;
  panel.innerHTML = `<p class="description">Set up <code>postgres_fdw</code> and map each local role to a remote database user. SQL generation only. Every value below is an example.</p><div class="fdw-notice"><strong>No passwords in this site.</strong> Downloaded SQL contains blocking credential placeholders. Replace every full marker privately with UTF-8 hex of the remote password, including the preflight guard. Hex is reversible, not encryption.</div><div class="field-grid">${field("server", "Local foreign-server name", "example_server")}${field("localDatabase", "Connected local database", "example_db", "A preflight guard verifies this database name.")}</div><div class="field-grid">${field("host", "Remote host", "remote.example.invalid", "One hostname or IP. Connections originate from your database server.")}${field("port", "Remote port", "5432")}</div>${field("database", "Remote database", "example_remote_db")}<div class="field-grid">${select(
    "sslmode",
    "Transport security",
    [
      ["verify-full", "verify-full · verify hostname & CA"],
      ["require", "require · encryption only"],
      ["disable", "disable · isolated tests only"],
    ],
    "verify-full",
  )}${field("sslrootcert", "CA path on database server (optional)", "", "For verify-full only. Not a local upload. Aurora filesystem and trust configuration are managed.")}</div><div class="subheading"><h3>Role mappings</h3><button type="button" class="text-button" id="add-mapping">+ Add mapping</button></div><p class="hint">Mapped local roles must already exist before this plan runs. Explicit local role → remote user. Group membership does not inherit a group user mapping. No PUBLIC mappings, remote logins, or IAM roles are created.</p><div id="mapping-rows"></div>${select(
    "access",
    "Local table permissions",
    [
      ["reader", "Reader · SELECT"],
      ["writer", "Read + write · SELECT, INSERT, UPDATE, DELETE"],
    ],
    "reader",
  )}${select(
    "mode",
    "Foreign table setup",
    [
      ["import", "Import remote schema"],
      ["manual", "Define one foreign table"],
      ["server", "Server + mappings only"],
    ],
    "import",
  )}<div id="fdw-tables"></div><details class="fdw-checklist"><summary>Remote-side permissions & prerequisites</summary><ul><li>Remote user already exists with LOGIN and authentication configured.</li><li>Remote CONNECT, schema USAGE, and table SELECT. Writers also need INSERT, UPDATE, DELETE and sequence rights for remote defaults where needed.</li><li>DNS, routes, firewalls/security groups, remote authentication, and trusted TLS certificates configured at the database server.</li><li>Local extension/server/mapping authority and permission to grant database, schema, and table access.</li></ul><p>Local grants never grant remote access. Aurora availability and privileges vary by engine release. Existing servers/mappings are not silently overwritten.</p></details>`;
  $("add-mapping").addEventListener("click", () =>
    mappingRow("example_reporter", "example_remote_reader"),
  );
  mappingRow();
  mappingRow("example_importer", "example_remote_reader");
  $("mode").addEventListener("change", tableFields);
  tableFields();
  $("sslmode").addEventListener("change", () => {
    $("sslrootcert").disabled = $("sslmode").value !== "verify-full";
    if ($("sslrootcert").disabled) $("sslrootcert").value = "";
  });
}
export function readFdwOperation() {
  const value = (id) => $(id)?.value ?? "";
  const op = { kind: "fdw" };
  for (const key of [
    "server",
    "localDatabase",
    "host",
    "port",
    "database",
    "sslmode",
    "sslrootcert",
    "localSchema",
    "remoteSchema",
    "access",
    "mode",
  ])
    op[key] = value(key);
  op.mappings = [...document.querySelectorAll(".mapping-row")].map((row) => ({
    localRole: value(`mapping-${row.dataset.row}-local`),
    remoteUser: value(`mapping-${row.dataset.row}-remote`),
  }));
  if (op.mode === "import")
    for (const key of ["importAs", "importFilter", "tables"])
      op[key] = value(key);
  if (op.mode === "manual") {
    op.localTable = value("localTable");
    op.remoteTable = value("remoteTable");
    op.columns = [...document.querySelectorAll(".column-row")].map((row) => {
      const id = row.dataset.row;
      return {
        localName: value(`column-${id}-name`),
        type: value(`column-${id}-type`),
        remoteName: value(`column-${id}-remote`),
        notNull: $(`column-${id}-notnull`).checked,
      };
    });
  }
  return op;
}
