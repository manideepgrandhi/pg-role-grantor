const fail = (message) => {
  throw new Error(message);
};
export function identifier(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail("Names must be non-empty and contain no control characters.");
  value = value.trim();
  if (new TextEncoder().encode(value).length > 63)
    fail("Identifiers must be at most 63 UTF-8 bytes.");
  return '"' + value.replaceAll('"', '""') + '"';
}
export function names(value, optional = false) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,\n]/);
  const clean = items.map((x) => String(x).trim()).filter(Boolean);
  if (!clean.length && !optional) fail("Enter at least one name.");
  clean.forEach(identifier);
  return [...new Set(clean)];
}
export const quoted = (value) => names(value).map(identifier).join(", ");
export const literal = (value) =>
  "E'" + value.replaceAll("\\", "\\\\").replaceAll("'", "''") + "'";
export function qualified(value) {
  const parts = String(value).trim().split(".");
  if (parts.length > 2)
    fail("Use name or schema.name. Do not enter SQL quoting.");
  return parts.map(identifier).join(".");
}
export function argumentType(value) {
  value = String(value).trim();
  const arrays = value.match(/(?:\[\])+$/)?.[0] ?? "";
  const base = value.slice(0, value.length - arrays.length).trim();
  const builtin = [
    "smallint",
    "integer",
    "bigint",
    "int",
    "int2",
    "int4",
    "int8",
    "real",
    "double precision",
    "numeric",
    "decimal",
    "boolean",
    "bool",
    "text",
    "varchar",
    "character varying",
    "character",
    "char",
    "bytea",
    "date",
    "time",
    "time without time zone",
    "time with time zone",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone",
    "timestamptz",
    "timetz",
    "interval",
    "uuid",
    "json",
    "jsonb",
    "record",
    "void",
    "oid",
    "regclass",
    "regtype",
    "anyelement",
    "anyarray",
    "anycompatible",
    "anycompatiblearray",
  ];
  if (builtin.includes(base.toLowerCase())) return base.toLowerCase() + arrays;
  if (!/^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/.test(base))
    fail(
      "Argument types must be built-in types or simple custom type names, optionally schema-qualified and with []. No typmods, modes, names, or SQL expressions.",
    );
  return qualified(base) + arrays;
}

export function doBlock(tag, body) {
  let delimiter = `$${tag}$`;
  while (body.includes(delimiter)) delimiter = delimiter.slice(0, -1) + "_$";
  return `DO ${delimiter}\n${body}\n${delimiter};`;
}
