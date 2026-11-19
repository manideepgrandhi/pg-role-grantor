export const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
// Hints are reachable but out of the way: a small "?" next to the label shows
// or hides them. aria-describedby still points at the hidden text.
const strip = (html) => String(html).replace(/<[^>]*>/g, "");
const labelRow = (name, label, hint) =>
  hint
    ? `<div class="label-row"><label for="${name}">${label}</label><button type="button" class="help" aria-expanded="false" aria-controls="${name}-hint" aria-label="Show help for ${esc(strip(label))}" title="Show help">?</button></div>`
    : `<label for="${name}">${label}</label>`;
const hintBox = (name, hint) =>
  hint ? `<p class="hint" id="${name}-hint" hidden>${hint}</p>` : "";
// Optional fields start blank and show `placeholder` instead of an example value.
export function field(
  name,
  label,
  value = "",
  hint = "",
  type = "input",
  placeholder = "",
) {
  const hold = placeholder ? ` placeholder="${esc(placeholder)}"` : "";
  const control =
    type === "textarea"
      ? `<textarea id="${name}" name="${name}" spellcheck="false"${hold}>${esc(value)}</textarea>`
      : `<input id="${name}" name="${name}" value="${esc(value)}" autocomplete="off" spellcheck="false"${hold}>`;
  return `<div class="field">${labelRow(name, label, hint)}${control}${hintBox(name, hint)}</div>`;
}
export function select(name, label, options, value, hint = "") {
  return `<div class="field">${labelRow(name, label, hint)}<select id="${name}" name="${name}">${options.map(([key, text, disabled]) => `<option value="${esc(key)}"${key === value ? " selected" : ""}${disabled ? " disabled" : ""}>${esc(text)}</option>`).join("")}</select>${hintBox(name, hint)}</div>`;
}
export function check(name, label, checked = false) {
  return `<label class="check"><input type="checkbox" name="${name}" id="${name}"${checked ? " checked" : ""}>${label}</label>`;
}

export function checkboxGroup(id, legend, hint, choices) {
  return `<fieldset class="choice-group" id="${id}" aria-describedby="${id}-hint"><legend>${esc(legend)}</legend><div class="choice-actions"><button class="text-button" type="button" id="${id}-select-all" aria-label="Select all ${esc(legend.toLowerCase())}">Select all</button><button class="text-button" type="button" id="${id}-clear-all" aria-label="Clear all ${esc(legend.toLowerCase())}">Clear all</button></div><p class="hint" id="${id}-hint">${esc(hint)}</p><div class="checks" id="${id}-choices">${choices.map(({ value, name, label = value, checked = false, disabled = false, all = false }, i) => `<label class="check${all ? " all-privileges" : ""}" for="${id}-${i}"><input type="checkbox" id="${id}-${i}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span>${esc(label)}</span></label>`).join("")}</div></fieldset>`;
}

// Collapsed "Advanced options" block. The summary shows how many inputs inside
// differ from their defaults, e.g. "(2 set)" (filled in by app.js).
export function advanced(id, title, inner) {
  return `<details class="field advanced" id="${id}"><summary>${title} <span class="adv-count"></span></summary>${inner}</details>`;
}
