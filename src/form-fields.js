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
