import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { generate } from "../src/generator.js";
const fdw = {
  kind: "fdw",
  server: "example_server",
  localDatabase: "example_db",
  host: "remote.example.invalid",
  port: "5432",
  database: "example_remote_db",
  sslmode: "verify-full",
  localSchema: "example_foreign",
  remoteSchema: "example_remote",
  mappings: [
    { localRole: "example_app", remoteUser: "example_remote_reader" },
    { localRole: "example_importer", remoteUser: "example_remote_reader" },
  ],
  mode: "import",
  access: "reader",
  importAs: "example_importer",
  importFilter: "limit",
  tables: "example_items",
};
export const EXAMPLE_PLANS = {
  "writer.sql": [
    {
      kind: "profile",
      profile: "writer",
      group: "example_writer",
      database: "example_db",
      schemas: "example_schema",
      creators: "example_owner",
      members: "app",
    },
  ],
  "fdw-import.sql": [fdw],
  "fdw-manual.sql": [
    {
      ...fdw,
      server: "example_manual_server",
      mode: "manual",
      importAs: undefined,
      tables: "",
      mappings: fdw.mappings.slice(0, 1),
      localTable: "example_items",
      remoteTable: "example_items",
      columns: [
        { localName: "id", type: "integer" },
        {
          localName: "description",
          type: "text",
          remoteName: "remote_description",
        },
      ],
    },
  ],
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const [file, operations] of Object.entries(EXAMPLE_PLANS))
    writeFileSync(
      new URL(file, import.meta.url),
      generate({ platform: "postgres", version: 17 }, operations).sql,
    );
}
