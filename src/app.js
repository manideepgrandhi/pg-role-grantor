import { esc, field, select, check } from "./form-fields.js";
import { renderFdwForm, readFdwOperation } from "./fdw-form.js";
import { catalog, predefined } from "./catalog.js";
import { generate } from "./generator.js";
const $ = (id) => document.getElementById(id);
const context = () => ({
  platform: $("platform").value,
  version: Number($("version").value),
});
let tab = "profile",
  profile = "writer",
  plan = [],
  latest = "";
const listHint =
  "Comma-separated or one per line. Enter names without SQL quotes. Case is preserved.";
function common() {
  return `<div class="field-grid">${select(
    "action",
    "Operation",
    [
      ["grant", "GRANT"],
      ["revoke", "REVOKE"],
    ],
    "grant",
  )}${field("grantees", "Recipient roles", "example_app", listHint)}</div><div class="field">${check("public", "Target PUBLIC (all current and future roles)")}</div>`;
}
function options() {
  return `<details class="field"><summary>Delegation & revoke options</summary><div class="field">${check("grantOption", "WITH GRANT OPTION (GRANT only)")}</div><div class="field">${check("optionOnly", "Revoke grant option only (REVOKE only)")}</div>${select(
    "behavior",
    "Dependent grants",
    [
      ["RESTRICT", "RESTRICT · fail if dependencies exist"],
      ["CASCADE", "CASCADE · remove dependent grants"],
    ],
    "RESTRICT",
  )}</details>`;
}
function renderForm() {
  const entries = catalog(context().version);
  $("operation-panel").setAttribute("aria-labelledby", `tab-${tab}`);
  $("form-error").hidden = true;
  if (tab === "profile") {
    $("operation-panel").innerHTML =
      `<p class="description">Create a NOLOGIN group, grant existing and future access, and assign it to existing users in one script. Values below are examples.</p><div class="profile-cards" role="group" aria-label="Access profile">${[
        ["reader", "Reader", "SELECT on tables"],
        ["writer", "Read + write", "SELECT, INSERT, UPDATE, DELETE"],
        ["executor", "Routine executor", "EXECUTE on routines"],
      ]
        .map(
          ([key, title, help]) =>
            `<button type="button" class="profile-card ${key === profile ? "active" : ""}" data-profile="${key}" aria-pressed="${key === profile}"><strong>${title}</strong><span>${help}</span></button>`,
        )
        .join(
          "",
        )}</div><div class="field-grid">${field("group", "Group role to create", "example_writer")}${field("database", "Target database", "example_db")}</div>${field("schemas", "Schemas", "example_schema", listHint)}${field("creators", "Future object creators", "example_owner", "Existing roles that actually create objects. Defaults follow the creator, not the schema owner.")}${field("members", "Assign to existing users / roles", "example_app", "Optional. These login or group roles must already exist. Passwords are never collected.")}<p class="description">Read + write includes sequence USAGE, but not setval, TRUNCATE, CREATE, or ownership. Setup adds grants; it does not remove broader existing access.</p>`;
    document.querySelectorAll("[data-profile]").forEach((button) =>
      button.addEventListener("click", () => {
        profile = button.dataset.profile;
        document.querySelectorAll("[data-profile]").forEach((b) => {
          b.classList.toggle("active", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        });
        $("group").value = `example_${profile}`;
      }),
    );
  } else if (tab === "object" || tab === "default") {
    const defaults = tab === "default";
    const choices = Object.entries(entries)
      .filter(([, v]) => !defaults || v.defaults)
      .map(([k, v]) => [k, v.label]);
    $("operation-panel").innerHTML =
      `<p class="description">${defaults ? "Configure future-object grants for each actual creator role. This does not change existing objects." : "Grant or revoke explicit privileges. Add another operation for a different object or permission set."}</p>${common()}${select("object", "Object type", choices, "table")}<div id="object-fields"></div><div class="field"><span class="label">Permissions</span><div class="checks" id="permissions"></div></div>${options()}`;
    $("object").addEventListener("change", () => renderObjectFields(defaults));
    $("public").addEventListener("change", () => {
      $("grantees").disabled = $("public").checked;
    });
    renderObjectFields(defaults);
  } else if (tab === "fdw") {
    renderFdwForm($("operation-panel"));
  } else if (tab === "membership") {
    $("operation-panel").innerHTML =
      `<p class="description">Assign existing roles to existing users. Membership is cluster-wide, not limited to a database or schema.</p>${select("builtin", "Predefined PostgreSQL roles", [["", "Custom role"], ...predefined(context().version, context().platform).map((r) => [r.name, `${r.name}${r.disabled ? " · unavailable" : ""}`, r.disabled])], "", "Built-in roles can expose broad cluster-wide capabilities. pg_database_owner has implicit membership only. AWS-managed roles are not generated.")}<p class="description" id="builtin-info"></p><div class="field-grid">${field("roles", "Roles to grant", "example_writer", listHint)}${field("members", "Member users / roles", "example_app", listHint)}</div>${select(
        "action",
        "Operation",
        [
          ["grant", "GRANT membership"],
          ["revoke", "REVOKE membership"],
        ],
        "grant",
      )}<div id="member-options"></div>`;
    $("builtin").addEventListener("change", () => {
      const role = predefined(context().version, context().platform).find(
        (r) => r.name === $("builtin").value,
      );
      if (role) $("roles").value = role.name;
      $("builtin-info").textContent = role
        ? `${role.description} ${role.note}`
        : "";
    });
    $("action").addEventListener("change", renderMemberOptions);
    renderMemberOptions();
  } else {
    $("operation-panel").innerHTML =
      `<p class="description">Create a reusable NOLOGIN permission group. Existing roles with LOGIN or elevated attributes are rejected. Login creation and password management stay outside this tool.</p>${field("group", "Group role name", "example_access", "Role names are cluster-wide. Use an application-specific prefix. No CREATE ROLE IF NOT EXISTS is assumed.")}<p class="description">The script does not clear existing permissions, ownership, or memberships. It does not grant CREATEROLE, CREATEDB, SUPERUSER, REPLICATION, or BYPASSRLS.</p>`;
  }
  document
    .querySelectorAll("#operation-panel input,#operation-panel textarea")
    .forEach((el) => {
      if ($(el.id + "-hint"))
        el.setAttribute("aria-describedby", el.id + "-hint");
    });
}
function renderObjectFields(defaults) {
  const key = $("object").value,
    entry = catalog(context().version)[key];
  let html;
  if (defaults)
    html =
      field("creators", "Future object creators", "example_owner", listHint) +
      field(
        "schemas",
        "Schema scope (blank = database-global)",
        key === "schema" ? "" : "example_schema",
        key === "schema"
          ? "SCHEMAS defaults must be global. Do not specify a schema."
          : "Leave blank for global defaults within this database. Per-schema REVOKE cannot remove globally granted privileges.",
      );
  else
    html = `${
      entry.all
        ? select(
            "scope",
            "Object scope",
            [
              ["named", "Named objects"],
              ["all", "All existing objects in schemas"],
            ],
            "named",
          )
        : ""
    }<div id="target-fields"></div>`;
  $("object-fields").innerHTML = html;
  $("permissions").innerHTML = [...entry.privileges, "ALL PRIVILEGES"]
    .map(
      (p, i) =>
        `<label class="check"><input type="checkbox" name="privilege" value="${p}"${i === 0 ? " checked" : ""}>${p}</label>`,
    )
    .join("");
  document.querySelectorAll("[name=privilege]").forEach((el) =>
    el.addEventListener("change", () => {
      if (el.checked)
        document.querySelectorAll("[name=privilege]").forEach((other) => {
          if (
            (el.value === "ALL PRIVILEGES" ||
              other.value === "ALL PRIVILEGES") &&
            el !== other
          )
            other.checked = false;
        });
    }),
  );
  if (!defaults) {
    if ($("scope")) $("scope").addEventListener("change", renderTargets);
    renderTargets();
  }
}
function renderTargets() {
  const entry = catalog(context().version)[$("object").value],
    key = $("object").value;
  if ($("scope")?.value === "all")
    $("target-fields").innerHTML = field(
      "schemas",
      "Schemas",
      "example_schema",
      listHint,
    );
  else {
    const sample = entry.routine
      ? "example_schema.example_routine"
      : key === "largeobject"
        ? "12345"
        : key === "parameter"
          ? "work_mem"
          : entry.qualified
            ? "example_schema.example_object"
            : `example_${key}`;
    $("target-fields").innerHTML =
      field(
        "targets",
        entry.routine
          ? "Routine name (without parentheses)"
          : key === "largeobject"
            ? "Large object OIDs"
            : "Object names",
        sample,
        entry.routine
          ? "One routine per operation. Use schema.name. Identify the overload with argument types below."
          : key === "largeobject"
            ? "Numeric OIDs only."
            : entry.qualified
              ? "Use schema.name. Comma-separated or one per line. Enter names without SQL quotes."
              : listHint,
      ) +
      (key === "column"
        ? field("columns", "Columns", "example_column", listHint)
        : "") +
      (entry.routine
        ? field(
            "argTypes",
            "Input argument types",
            "integer\ntext",
            "One type per line, in declaration order. Leave blank for zero arguments. Built-ins (double precision, timestamp with time zone), custom schema.type, and [] arrays are supported. No argument names, modes, or type modifiers.",
            "textarea",
          )
        : "");
  }
}
function renderMemberOptions() {
  const modern = context().version >= 16;
  $("member-options").innerHTML =
    $("action").value === "revoke"
      ? `${select(
          "revokeOption",
          "Revoke scope",
          [
            ["", "Entire membership"],
            ["ADMIN", "ADMIN option only"],
            ...(modern
              ? [
                  ["INHERIT", "INHERIT option only"],
                  ["SET", "SET option only"],
                ]
              : []),
          ],
          "",
        )}${select(
          "behavior",
          "Dependent grants",
          [
            ["RESTRICT", "RESTRICT"],
            ["CASCADE", "CASCADE"],
          ],
          "RESTRICT",
        )}`
      : `<div class="field">${check("admin", "Allow member to delegate membership (ADMIN)", false)}</div>${modern ? `<div class="field">${check("inherit", "Automatically inherit privileges (INHERIT)", true)}</div><div class="field">${check("set", "Allow SET ROLE", true)}</div>` : '<p class="description">On 14–15, inheritance follows the member role INHERIT attribute. SET ROLE is available through membership. ADMIN is only added when selected; existing ADMIN is not cleared.</p>'}`;
}
function readOperation() {
  if (tab === "fdw") return readFdwOperation();
  const data = new FormData($("operation-form")),
    op = { kind: tab };
  for (const [key, value] of data) if (key !== "privilege") op[key] = value;
  for (const key of [
    "public",
    "grantOption",
    "optionOnly",
    "admin",
    "inherit",
    "set",
  ])
    if ($(key)) op[key] = $(key).checked;
  if (tab === "profile") op.profile = profile;
  if (tab === "object" || tab === "default")
    op.privileges = data.getAll("privilege");
  delete op.builtin;
  return op;
}
function title(op) {
  if (op.kind === "fdw")
    return `FDW ${op.mode} · ${op.server} · ${op.mappings.length} role mapping${op.mappings.length === 1 ? "" : "s"}`;
  if (op.kind === "profile")
    return `${op.profile === "writer" ? "Read + write" : op.profile === "reader" ? "Reader" : "Routine executor"} setup · ${op.group}`;
  if (op.kind === "group") return `Create group · ${op.group}`;
  if (op.kind === "membership")
    return `${op.action === "revoke" ? "Revoke" : "Grant"} membership · ${op.roles}`;
  return `${op.kind === "default" ? "Future" : "Existing"} ${op.object} · ${op.action === "revoke" ? "REVOKE" : "GRANT"} ${op.privileges.join(", ")}`;
}
function highlight(sql) {
  return sql
    .split("\n")
    .map((line) => {
      if (line.startsWith("--"))
        return `<span class="sql-comment">${esc(line)}</span>`;
      const tokens =
        /("(?:[^"]|"")*"|E?'(?:[^']|'')*'|\b(?:BEGIN|COMMIT|GRANT|REVOKE|ALTER|DEFAULT|PRIVILEGES|FOR|ROLE|IN|SCHEMA|TABLES|SEQUENCES|FUNCTIONS|TO|FROM|ON|WITH|OPTION|SELECT|INSERT|UPDATE|DELETE|USAGE|EXECUTE|CONNECT|CREATE|DO|END|IF|THEN|ELSIF|NOT|EXISTS|TRUE|FALSE|ADMIN|INHERIT|SET)\b)/g;
      let out = "",
        last = 0;
      for (const m of line.matchAll(tokens)) {
        out += esc(line.slice(last, m.index));
        out += m[0].startsWith('"')
          ? esc(m[0])
          : `<span class="${m[0].includes("'") ? "sql-string" : "sql-keyword"}">${esc(m[0])}</span>`;
        last = m.index + m[0].length;
      }
      return out + esc(line.slice(last));
    })
    .join("\n");
}
function refresh() {
  $("plan-count").textContent = plan.length;
  $("empty-plan").hidden = Boolean(plan.length);
  $("plan-list").replaceChildren();
  plan.forEach((op, i) => {
    const li = document.createElement("li"),
      label = document.createElement("span"),
      num = document.createElement("span"),
      remove = document.createElement("button");
    num.className = "step";
    num.textContent = String(i + 1).padStart(2, "0");
    label.append(num, document.createTextNode(title(op)));
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove operation ${i + 1}`);
    remove.addEventListener("click", () => {
      plan.splice(i, 1);
      refresh();
    });
    li.append(label, remove);
    $("plan-list").append(li);
  });
  $("plan-error").hidden = true;
  latest = "";
  try {
    const result = generate(context(), plan);
    latest = result.sql;
    $("sql-code").innerHTML = highlight(result.sql);
    $("sql-lines").textContent =
      `${result.sql.trimEnd().split("\n").length} lines`;
    $("warnings").replaceChildren(
      ...result.warnings.map((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        return li;
      }),
    );
  } catch (e) {
    $("plan-error").hidden = false;
    $("plan-error").textContent =
      `The plan is incompatible with this target: ${e.message} Remove the incompatible operation or change the engine version.`;
    $("sql-code").textContent = "-- Export disabled until the plan is valid.";
    $("sql-lines").textContent = "";
  }
  $("copy").disabled = !latest || !plan.length;
  $("download").disabled = !latest || !plan.length;
  const rows = Object.values(catalog(context().version))
    .map(
      (entry) =>
        `<tr><td>${esc(entry.label)}</td><td>${entry.privileges.join(", ")}</td><td>${entry.defaults ? "Yes" : "—"}</td></tr>`,
    )
    .join("");
  $("coverage").innerHTML = rows;
  const v = context().version;
  $("source-links").innerHTML =
    `<a href="https://www.postgresql.org/docs/${v}/sql-grant.html" target="_blank" rel="noopener">GRANT reference ↗</a><a href="https://www.postgresql.org/docs/${v}/sql-alterdefaultprivileges.html" target="_blank" rel="noopener">Default privileges ↗</a><a href="https://www.postgresql.org/docs/${v}/predefined-roles.html" target="_blank" rel="noopener">Predefined roles ↗</a><a href="https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html" target="_blank" rel="noopener">Aurora restrictions ↗</a>`;
}
function switchTab(button) {
  tab = button.dataset.tab;
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b === button));
    b.tabIndex = b === button ? 0 : -1;
  });
  renderForm();
}
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button));
  button.addEventListener("keydown", (e) => {
    const buttons = [...document.querySelectorAll("[data-tab]")],
      i = buttons.indexOf(button);
    let next;
    if (e.key === "ArrowRight") next = buttons[(i + 1) % buttons.length];
    if (e.key === "ArrowLeft")
      next = buttons[(i + buttons.length - 1) % buttons.length];
    if (e.key === "Home") next = buttons[0];
    if (e.key === "End") next = buttons.at(-1);
    if (next) {
      e.preventDefault();
      switchTab(next);
      next.focus();
    }
  });
});
$("operation-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const op = readOperation();
    generate(context(), [...plan, op]);
    plan.push(op);
    $("form-error").hidden = true;
    refresh();
    $("status").textContent = "Operation added to the script.";
  } catch (e) {
    $("form-error").hidden = false;
    $("form-error").textContent = e.message;
  }
});
for (const id of ["platform", "version"])
  $(id).addEventListener("change", () => {
    renderForm();
    refresh();
  });
$("clear").addEventListener("click", () => {
  plan = [];
  refresh();
  $("status").textContent = "Script plan cleared.";
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(latest);
    $("status").textContent = "SQL copied to clipboard.";
  } catch {
    $("status").textContent =
      "Clipboard unavailable. Select the SQL preview or download the file.";
  }
});
$("download").addEventListener("click", () => {
  if (!latest) return;
  const url = URL.createObjectURL(
      new Blob([latest], { type: "application/sql;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "permission-plan.sql";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("status").textContent = "SQL file downloaded.";
});
renderForm();
refresh();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      $("offline-status").textContent =
        "Offline cache ready · No form values saved";
    })
    .catch(() => {
      $("offline-status").textContent =
        "Offline cache unavailable · Use a local web server";
    });
}
