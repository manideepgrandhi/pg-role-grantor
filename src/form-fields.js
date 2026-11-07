export const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function field(name, label, value = "", hint = "", type = "input") {
  const control =
    type === "textarea"
      ? `<textarea id="${name}" name="${name}" spellcheck="false">${esc(value)}</textarea>`
      : `<input id="${name}" name="${name}" value="${esc(value)}" autocomplete="off" spellcheck="false">`;
  return `<div class="field"><label for="${name}">${label}</label>${control}${hint ? `<p class="hint" id="${name}-hint">${hint}</p>` : ""}</div>`;
}
export function select(name, label, options, value, hint = "") {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([key, text, disabled]) => `<option value="${esc(key)}"${key === value ? " selected" : ""}${disabled ? " disabled" : ""}>${esc(text)}</option>`).join("")}</select>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
}
export function check(name, label, checked = false) {
  return `<label class="check"><input type="checkbox" name="${name}" id="${name}"${checked ? " checked" : ""}>${label}</label>`;
}

export function checkboxGroup(id, legend, hint, choices) {
  return `<fieldset class="choice-group" id="${id}" aria-describedby="${id}-hint"><legend>${esc(legend)}</legend><div class="choice-actions"><button class="text-button" type="button" id="${id}-select-all" aria-label="Select all ${esc(legend.toLowerCase())}">Select all</button><button class="text-button" type="button" id="${id}-clear-all" aria-label="Clear all ${esc(legend.toLowerCase())}">Clear all</button></div><p class="hint" id="${id}-hint">${esc(hint)}</p><div class="checks" id="${id}-choices">${choices.map(({ value, name, label = value, checked = false, disabled = false, all = false }, i) => `<label class="check${all ? " all-privileges" : ""}" for="${id}-${i}"><input type="checkbox" id="${id}-${i}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span>${esc(label)}</span></label>`).join("")}</div></fieldset>`;
}
