import { esc, field, select, check, checkboxGroup } from "./form-fields.js";
import { renderFdwForm, readFdwOperation } from "./fdw-form.js";
import { catalog, predefined } from "./catalog.js";
import { generate, SINGLE_TYPES } from "./generator.js";
import { summarize } from "./plan-review.js";
import { generateVerification } from "./verification.js";
import { names } from "./sql-input.js";
const $ = (id) => document.getElementById(id);
const context = () => ({
  platform: $("platform").value,
  version: Number($("version").value),
});
const OPERATIONS = {
  profile: "Access setup",
  grants: "Grants",
  membership: "Membership",
  group: "Create role",
  fdw: "FDW setup",
};
const PROFILES = [
  ["reader", "Reader", "Read tables and sequences, run functions"],
  ["writer", "Read + write", "Reader plus INSERT, UPDATE, DELETE, TRUNCATE"],
  ["executor", "Routine executor", "EXECUTE on routines"],
];
const PROFILE_HELP = {
  reader:
    "CONNECT, schema USAGE, SELECT on tables, SELECT + USAGE on sequences, EXECUTE on functions, USAGE on future types.",
  writer:
    "Everything in Reader plus INSERT, UPDATE, DELETE, TRUNCATE on tables. No setval or CREATE.",
  executor: "CONNECT, schema USAGE, EXECUTE on existing and future routines.",
};
const COMMON_TYPES = ["table", "schema", "database", "sequence", "routine"];
let operation = "profile",
  grantMode = "object",
  profile = "writer",
  plan = [],
  latest = "",
  verification = "";
// Detached controls keep pane-local values and listeners without duplicate IDs.
const formDrafts = new Map(),
  grantDrafts = new Map();
const listHint = "Comma-separated or one per line, without SQL quotes.";
const creatorsField = () =>
  field(
    "creators",
    "Future object creators (optional)",
    "",
    "Blank = only objects created by the role that runs the script.",
    "input",
    "example_owner",
  );
function stash(container) {
  const draft = document.createDocumentFragment();
  draft.append(...container.childNodes);
  return draft;
}
function common() {
  return `<div class="field-grid">${select(
    "action",
    "Action",
    [
      ["grant", "GRANT"],
      ["revoke", "REVOKE"],
    ],
    "grant",
  )}${field("grantees", "Recipient roles", "example_app", listHint)}</div><div class="field">${check("public", "Target PUBLIC (all current and future roles)")}</div>`;
}
function options() {
  return `<details class="field advanced"><summary>Delegation & revoke options</summary><div class="field">${check("grantOption", "WITH GRANT OPTION (GRANT only)")}</div><div class="field">${check("optionOnly", "Revoke grant option only (REVOKE only)")}</div>${select(
    "behavior",
    "Dependent grants",
    [
      ["RESTRICT", "RESTRICT · fail if dependencies exist"],
      ["CASCADE", "CASCADE · remove dependent grants"],
    ],
    "RESTRICT",
  )}</details>`;
}
function clearFormFeedback() {
  $("form-error").hidden = true;
  $("form-error").textContent = "";
  $("form-feedback").textContent = "";
  $("status").textContent = "";
}
function describeFields() {
  document
    .querySelectorAll("#operation-panel input,#operation-panel textarea")
    .forEach((el) => {
      if ($(el.id + "-hint"))
        el.setAttribute("aria-describedby", el.id + "-hint");
    });
}
// Carries user edits (not untouched examples) across a re-render of `container`.
function keepEdits(container) {
  const edits = [
    ...container.querySelectorAll("input:not([type=checkbox]),textarea"),
  ]
    .filter((el) => el.value !== el.defaultValue)
    .map((el) => [el.id, el.value]);
  return () =>
    edits.forEach(([id, value]) => {
      if ($(id)) $(id).value = value;
    });
}
function bindChoices(id, exclusiveValue, onChange = () => {}) {
  const inputs = () => [...$(id).querySelectorAll('input[type="checkbox"]')];
  $(id + "-select-all").addEventListener("click", () => {
    inputs().forEach((input) => {
      input.checked = !input.disabled && input.value !== exclusiveValue;
    });
    onChange();
  });
  $(id + "-clear-all").addEventListener("click", () => {
    inputs().forEach((input) => (input.checked = false));
    onChange();
  });
  inputs().forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked && exclusiveValue)
        inputs().forEach((other) => {
          if (
            input !== other &&
            (input.value === exclusiveValue || other.value === exclusiveValue)
          )
            other.checked = false;
        });
      onChange();
    }),
  );
}
function renderForm() {
  clearFormFeedback();
  const panel = $("operation-panel");
  panel.setAttribute("aria-label", OPERATIONS[operation]);
  if (operation === "profile") {
    panel.innerHTML = `<div class="profile-cards" role="group" aria-label="Access profile">${PROFILES.map(
      ([key, title, help]) =>
        `<button type="button" class="profile-card ${key === profile ? "active" : ""}" data-profile="${key}" aria-pressed="${key === profile}"><strong>${title}</strong><span>${help}</span></button>`,
    ).join(
      "",
    )}</div><p class="description" id="profile-help">${PROFILE_HELP[profile]}</p><div class="field-grid">${field("group", "Group role to create", `example_${profile}`)}${field("database", "Target database", "example_db")}</div>${field("schemas", "Schemas", "example_schema", listHint)}${creatorsField()}${field("members", "Assign to users / roles (optional)", "", "Must already exist. Passwords are never collected.", "input", "example_app")}`;
    document.querySelectorAll("[data-profile]").forEach((button) =>
      button.addEventListener("click", () => {
        profile = button.dataset.profile;
        document.querySelectorAll("[data-profile]").forEach((b) => {
          b.classList.toggle("active", b === button);
          b.setAttribute("aria-pressed", String(b === button));
        });
        $("profile-help").textContent = PROFILE_HELP[profile];
        $("group").value = `example_${profile}`;
      }),
    );
  } else if (operation === "grants") {
    panel.innerHTML = `<div class="segmented" role="group" aria-label="Grant target">${[
      ["object", "Existing objects"],
      ["default", "Future objects"],
    ]
      .map(
        ([key, text]) =>
          `<button type="button" id="grant-mode-${key}" data-grant-mode="${key}" aria-pressed="${key === grantMode}">${text}</button>`,
      )
      .join("")}</div><div id="grant-body"></div>`;
    panel
      .querySelectorAll("[data-grant-mode]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          switchGrantMode(button.dataset.grantMode),
        ),
      );
    renderGrantBody();
  } else if (operation === "fdw") {
    renderFdwForm(panel);
  } else if (operation === "membership") {
    const builtins = predefined(context().version, context().platform);
    panel.innerHTML = `<p class="description">Grant existing roles to existing users. Membership is cluster-wide.</p><div class="field-grid">${field("roles", "Roles to grant", "", "Optional when predefined roles are checked. " + listHint, "input", "example_writer")}${field("members", "Member users / roles", "example_app", listHint)}</div><details class="field advanced" id="builtin-panel"><summary>Predefined PostgreSQL roles</summary>${checkboxGroup(
      "builtin",
      "Predefined PostgreSQL roles",
      "None selected by default. Select all includes powerful roles, such as host-file and program access where available. Unavailable roles stay disabled. AWS-managed roles are not generated.",
      builtins.map((r) => ({
        value: r.name,
        name: "builtin",
        label: r.name + (r.disabled ? " · " + r.note : ""),
        disabled: r.disabled,
      })),
    )}<div class="description" id="builtin-info" aria-live="polite"></div></details>${select(
      "action",
      "Action",
      [
        ["grant", "GRANT membership"],
        ["revoke", "REVOKE membership"],
      ],
      "grant",
    )}<div id="member-options"></div>`;
    bindChoices("builtin", undefined, () => {
      const selected = new Set(
        [...document.querySelectorAll('[name="builtin"]:checked')].map(
          (el) => el.value,
        ),
      );
      $("builtin-info").innerHTML = selected.size
        ? `<ul>${builtins
            .filter((r) => selected.has(r.name))
            .map(
              (r) =>
                `<li><strong>${esc(r.name)}</strong>: ${esc(r.description)} ${esc(r.note)}</li>`,
            )
            .join("")}</ul>`
        : "";
    });
    $("action").addEventListener("change", renderMemberOptions);
    renderMemberOptions();
  } else {
    panel.innerHTML = `<p class="description">Create a reusable NOLOGIN group. Existing LOGIN or elevated roles are rejected.</p>${field("group", "Group role name", "example_access", "Cluster-wide. No login, password, or elevated attributes.")}`;
  }
  describeFields();
}
function switchGrantMode(mode) {
  if (mode === grantMode) return;
  grantDrafts.set(grantMode, stash($("grant-body")));
  grantMode = mode;
  document
    .querySelectorAll("[data-grant-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.grantMode === mode)),
    );
  const saved = grantDrafts.get(mode);
  if (saved) {
    grantDrafts.delete(mode);
    $("grant-body").replaceChildren(saved);
    clearFormFeedback();
  } else renderGrantBody();
}
function selectedTypes() {
  return [...document.querySelectorAll('[name="objtype"]:checked')].map(
    (el) => el.value,
  );
}
function renderGrantBody() {
  clearFormFeedback();
  const future = grantMode === "default";
  const entries = Object.entries(catalog(context().version)).filter(
    ([, e]) => !future || e.defaults,
  );
  const box = ([key, e]) =>
    `<label class="check" for="type-${key}"><input type="checkbox" id="type-${key}" name="objtype" value="${key}"${key === "table" ? " checked" : ""}><span>${esc(e.label)}</span></label>`;
  const top = entries
      .filter(([key]) => COMMON_TYPES.includes(key))
      .sort(([a], [b]) => COMMON_TYPES.indexOf(a) - COMMON_TYPES.indexOf(b)),
    more = entries.filter(([key]) => !COMMON_TYPES.includes(key));
  $("grant-body").innerHTML =
    `<p class="description">${future ? "Privileges for objects created later (ALTER DEFAULT PRIVILEGES)." : "Grant or revoke on objects that exist now."}</p>${common()}<fieldset class="choice-group" id="objtype" aria-describedby="objtype-hint"><legend>Object types</legend><p class="hint" id="objtype-hint">Check several to grant them together. Each type gets only the permissions it supports.${future ? "" : " Columns, large objects, and parameters go one at a time."}</p><div class="checks">${top.map(box).join("")}</div>${more.length ? `<details class="more-types" id="more-types"><summary>More</summary><div class="checks">${more.map(box).join("")}</div></details>` : ""}</fieldset><div id="object-fields"></div><div id="permissions"></div>${options()}`;
  document.querySelectorAll('[name="objtype"]').forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked)
        document.querySelectorAll('[name="objtype"]').forEach((other) => {
          if (
            other !== input &&
            (SINGLE_TYPES.includes(input.value) ||
              SINGLE_TYPES.includes(other.value))
          )
            other.checked = false;
        });
      renderObjectFields(true);
    }),
  );
  $("public").addEventListener("change", () => {
    $("grantees").disabled = $("public").checked;
  });
  renderObjectFields();
}
function renderObjectFields(preserve = false) {
  const future = grantMode === "default";
  const entries = catalog(context().version),
    types = selectedTypes(),
    list = types.map((key) => entries[key]);
  // Keep shared selections when types change; start fresh after an empty type set.
  const previous =
    preserve && document.querySelector('[name="privilege"]')
      ? new Set(
          [...document.querySelectorAll('[name="privilege"]:checked')]
            .map((el) => el.value)
            .filter((value) => value !== "ALL PRIVILEGES"),
        )
      : null;
  const restore = keepEdits($("object-fields")),
    scope = $("scope")?.value;
  if (future)
    $("object-fields").innerHTML =
      creatorsField() +
      field(
        "schemas",
        "Schema scope (optional)",
        "",
        types.includes("schema")
          ? "Leave blank. Schema defaults are always database-wide."
          : "Blank = database-wide. Per-schema REVOKE cannot remove global defaults.",
        "input",
        "example_schema",
      );
  else
    $("object-fields").innerHTML = `${
      list.length && list.every((e) => e.all)
        ? select(
            "scope",
            "Object scope",
            [
              ["named", "Named objects"],
              ["all", "All existing objects in schemas"],
            ],
            scope ?? "named",
          )
        : ""
    }<div id="target-fields"></div>`;
  const union = [...new Set(list.flatMap((e) => e.privileges))];
  $("permissions").innerHTML = types.length
    ? checkboxGroup(
        "permission",
        "Permissions",
        types.length > 1
          ? "Applied per type where supported. ALL PRIVILEGES cannot be combined with others."
          : "ALL PRIVILEGES cannot be combined with individual permissions.",
        [...union, "ALL PRIVILEGES"].map((value, i) => ({
          value,
          name: "privilege",
          checked: previous ? previous.has(value) : i === 0,
          all: value === "ALL PRIVILEGES",
        })),
      )
    : '<p class="hint" id="permissions-empty">Select at least one object type.</p>';
  if (types.length) bindChoices("permission", "ALL PRIVILEGES");
  if (!future) {
    if ($("scope"))
      $("scope").addEventListener("change", () => {
        const again = keepEdits($("target-fields"));
        renderTargets();
        again();
      });
    renderTargets();
  }
  restore();
  describeFields();
}
function renderTargets() {
  const entries = catalog(context().version),
    types = selectedTypes(),
    key = types[0],
    entry = entries[key];
  if (!entry) {
    $("target-fields").innerHTML = "";
    return;
  }
  if ($("scope")?.value === "all") {
    $("target-fields").innerHTML = field(
      "schemas",
      "Schemas",
      "example_schema",
      listHint,
    );
    return;
  }
  const single = types.length === 1,
    routine = single && entry.routine;
  const sample = routine
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
      routine
        ? "Routine name (without parentheses)"
        : key === "largeobject"
          ? "Large object OIDs"
          : "Object names",
      sample,
      !single
        ? "The same names apply to each type. Schema-wide scope is usually better when types differ."
        : routine
          ? "One routine per operation. Use schema.name and list argument types below."
          : key === "largeobject"
            ? "Numeric OIDs only."
            : entry.qualified
              ? "Use schema.name. " + listHint
              : listHint,
    ) +
    (single && key === "column"
      ? field("columns", "Columns", "example_column", listHint)
      : "") +
    (routine
      ? field(
          "argTypes",
          "Input argument types",
          "integer\ntext",
          "One type per line, in order. Blank = no arguments. Built-ins, schema.type, and [] arrays only.",
          "textarea",
        )
      : "");
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
      : `<div class="field">${check("admin", "Allow member to delegate membership (ADMIN)", false)}</div>${modern ? `<div class="field">${check("inherit", "Automatically inherit privileges (INHERIT)", true)}</div><div class="field">${check("set", "Allow SET ROLE", true)}</div>` : '<p class="hint">On 14–15, inheritance follows the member INHERIT attribute and SET ROLE is available. ADMIN is added only when checked.</p>'}`;
}
function readOperation() {
  if (operation === "fdw") return readFdwOperation();
  const kind = operation === "grants" ? grantMode : operation;
  const data = new FormData($("operation-form")),
    op = { kind };
  for (const [key, value] of data)
    if (!["privilege", "objtype", "builtin"].includes(key)) op[key] = value;
  for (const key of [
    "public",
    "grantOption",
    "optionOnly",
    "admin",
    "inherit",
    "set",
  ])
    if ($(key)) op[key] = $(key).checked;
  if (kind === "profile") op.profile = profile;
  if (operation === "grants") {
    op.objects = data.getAll("objtype");
    op.privileges = data.getAll("privilege");
  }
  if (kind === "membership") {
    op.roles = names(
      [...names(op.roles, true), ...data.getAll("builtin")],
      true,
    );
    if (!op.roles.length)
      throw new Error(
        "Choose at least one predefined role or enter a role to grant.",
      );
  }
  return op;
}
function title(op) {
  if (op.kind === "fdw")
    return `FDW ${op.mode} · ${op.server} · ${op.mappings.length} role mapping${op.mappings.length === 1 ? "" : "s"}`;
  if (op.kind === "profile")
    return `${op.profile === "writer" ? "Read + write" : op.profile === "reader" ? "Reader" : "Routine executor"} setup · ${op.group}`;
  if (op.kind === "group") return `Create group · ${op.group}`;
  if (op.kind === "membership")
    return `${op.action === "revoke" ? "Revoke" : "Grant"} membership · ${Array.isArray(op.roles) ? op.roles.join(", ") : op.roles}`;
  return `${op.kind === "default" ? "Future" : "Existing"} ${(op.objects ?? [op.object]).join(" + ")} · ${op.action === "revoke" ? "REVOKE" : "GRANT"} ${op.privileges.join(", ")}`;
}
function highlight(sql) {
  return sql
    .split("\n")
    .map((line) => {
      if (line.startsWith("--"))
        return `<span class="sql-comment">${esc(line)}</span>`;
      const tokens =
        /("(?:[^"]|"")*"|E?'(?:[^']|'')*'|\b(?:BEGIN|COMMIT|GRANT|REVOKE|ALTER|DEFAULT|PRIVILEGES|FOR|ROLE|IN|SCHEMA|TABLES|SEQUENCES|FUNCTIONS|TYPES|TO|FROM|ON|WITH|OPTION|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|USAGE|EXECUTE|CONNECT|CREATE|DO|END|IF|THEN|ELSIF|NOT|EXISTS|TRUE|FALSE|ADMIN|INHERIT|SET)\b)/g;
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
function planItem(op, i, review) {
  const li = document.createElement("li"),
    details = document.createElement("details"),
    heading = document.createElement("summary"),
    num = document.createElement("span"),
    remove = document.createElement("button");
  num.className = "step";
  num.textContent = String(i + 1).padStart(2, "0");
  heading.append(num, document.createTextNode(title(op)));
  details.append(heading);
  if (review) {
    const lines =
      review.title === review.details[0]
        ? review.details
        : [review.title, ...review.details];
    const list = document.createElement("ul");
    for (const text of lines) {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    }
    details.append(list);
  }
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Remove operation ${i + 1}`);
  remove.addEventListener("click", () => {
    plan.splice(i, 1);
    refresh();
  });
  li.append(details, remove);
  return li;
}
function refresh() {
  $("plan-count").textContent = plan.length;
  $("empty-plan").hidden = Boolean(plan.length);
  $("plan-error").hidden = true;
  latest = "";
  verification = "";
  let result, review;
  try {
    result = generate(context(), plan);
    review = summarize(context(), plan);
    latest = result.sql;
    verification = generateVerification(context(), plan).sql;
    $("sql-code").innerHTML = highlight(latest);
    $("verify-code").innerHTML = highlight(verification);
    $("sql-lines").textContent = `${latest.trimEnd().split("\n").length} lines`;
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
    $("verify-code").textContent =
      "-- Export disabled until the plan is valid.";
    $("sql-lines").textContent = "";
  }
  $("plan-list").replaceChildren(
    ...plan.map((op, i) => planItem(op, i, review?.[i])),
  );
  const off = !latest || !plan.length;
  for (const id of ["copy", "download", "verify-copy", "verify-download"])
    $(id).disabled = off;
  $("coverage").innerHTML = Object.values(catalog(context().version))
    .map(
      (entry) =>
        `<tr><td>${esc(entry.label)}</td><td>${entry.privileges.join(", ")}</td><td>${entry.defaults ? "Yes" : "—"}</td></tr>`,
    )
    .join("");
  const v = context().version;
  $("source-links").innerHTML =
    `<a href="https://www.postgresql.org/docs/${v}/sql-grant.html" target="_blank" rel="noopener">GRANT reference ↗</a><a href="https://www.postgresql.org/docs/${v}/sql-alterdefaultprivileges.html" target="_blank" rel="noopener">Default privileges ↗</a><a href="https://www.postgresql.org/docs/${v}/predefined-roles.html" target="_blank" rel="noopener">Predefined roles ↗</a><a href="https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html" target="_blank" rel="noopener">Aurora restrictions ↗</a>`;
}
function switchOperation(next) {
  if (next === operation) return;
  formDrafts.set(operation, stash($("operation-panel")));
  operation = next;
  const saved = formDrafts.get(next);
  if (saved) {
    formDrafts.delete(next);
    $("operation-panel").replaceChildren(saved);
    $("operation-panel").setAttribute("aria-label", OPERATIONS[next]);
    clearFormFeedback();
  } else renderForm();
}
$("operation").addEventListener("change", () =>
  switchOperation($("operation").value),
);
$("operation-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("form-feedback").textContent = "";
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
    formDrafts.clear();
    grantDrafts.clear();
    profile = "writer";
    renderForm();
    refresh();
  });
$("reset-form").addEventListener("click", () => {
  if (operation === "profile") profile = "writer";
  // Grants resets only the visible Existing / Future form.
  if (operation === "grants") renderGrantBody();
  else renderForm();
  $("form-feedback").textContent =
    "Form reset to defaults. Script plan unchanged.";
  $("reset-form").focus();
});
$("clear").addEventListener("click", () => {
  if (
    !plan.length ||
    !window.confirm(
      "Clear every operation from the script plan? Your current form and target engine will stay unchanged.",
    )
  )
    return;
  plan = [];
  refresh();
  $("status").textContent = "Script plan cleared.";
});
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    $("status").textContent = `${what} copied to clipboard.`;
  } catch {
    $("status").textContent =
      "Clipboard unavailable. Select the SQL preview or download the file.";
  }
}
function download(text, file) {
  if (!text) return;
  const url = URL.createObjectURL(
      new Blob([text], { type: "application/sql;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("status").textContent = `${file} downloaded.`;
}
$("copy").addEventListener("click", () => copy(latest, "Setup SQL"));
$("download").addEventListener("click", () =>
  download(latest, "permission-plan.sql"),
);
$("verify-copy").addEventListener("click", () =>
  copy(verification, "Verification SQL"),
);
$("verify-download").addEventListener("click", () =>
  download(verification, "permission-verification.sql"),
);
$("operation").value = operation;
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
