const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const artifacts =
    process.env.ARTIFACTS || "/workspace/pg-role-grantor-artifacts/checkbox";
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let count = 0;
  const check = (actual, expected = true) => {
    assert.deepEqual(actual, expected);
    count++;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => {
      if (
        /^https?:/.test(r.url()) &&
        new URL(r.url()).origin !== new URL(url).origin
      )
        external.push(r.url());
    });
    await page.goto(url, { waitUntil: "networkidle0" });
    const sql = () => page.$eval("#sql-code", (e) => e.textContent);
    const selected = (name) =>
      page.$$eval(`[name=${name}]:checked`, (els) => els.map((e) => e.value));
    const choose = (name, value) => click(`[name=${name}][value="${value}"]`);
    const set = (id, value) =>
      page.$eval("#" + id, (e, v) => (e.value = v), value);
    const val = (id) => page.$eval("#" + id, (e) => e.value);
    const add = () => page.click("button[type=submit]");
    const planCount = () => page.$eval("#plan-count", (e) => e.textContent);
    // Controls inside collapsed details are opened first, as a user would.
    const reveal = (selector) =>
      page
        .$eval(selector, (e) => {
          for (
            let d = e.closest("details");
            d;
            d = d.parentElement?.closest("details")
          )
            d.open = true;
        })
        .catch(() => {});
    const click = async (selector) => {
      await reveal(selector);
      await page.click(selector);
    };
    const focus = async (selector) => {
      await reveal(selector);
      await page.focus(selector);
    };
    const operation = (value) => page.select("#operation", value);
    const grants = async (mode) => {
      await operation("grants");
      await click("#grant-mode-" + mode);
    };
    // Check the new type first, then clear the rest, like changing a dropdown.
    const switchType = async (key) => {
      const box = "#type-" + key;
      if (!(await page.$eval(box, (e) => e.checked).catch(() => false)))
        await click(box);
      for (const other of await page.$$eval("[name=objtype]:checked", (els) =>
        els.map((e) => e.value),
      ))
        if (other !== key) await click("#type-" + other);
    };
    await add();
    await grants("object");
    check(await page.$eval("#permission", (e) => e.tagName), "FIELDSET");
    check(
      await page.$eval("#permission legend", (e) => e.textContent),
      "Permissions",
    );
    check(
      await page.$$eval("#permission input", (els) =>
        els.every((e) => document.querySelector(`label[for="${e.id}"]`)),
      ),
    );
    const initial = await sql();
    await choose("privilege", "UPDATE");
    check(await selected("privilege"), ["SELECT", "UPDATE"]);
    check(await sql(), initial);
    await add();
    check(
      (await sql()).includes(
        'GRANT SELECT, UPDATE ON TABLE "example_schema"."example_object" TO "example_app";',
      ),
    );
    const queued = await sql();
    await click("#permission-select-all");
    const tableAll = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
      "MAINTAIN",
    ];
    check(await selected("privilege"), tableAll);
    check(await sql(), queued);
    await add();
    check((await sql()).includes("GRANT " + tableAll.join(", ") + " ON TABLE"));
    await click("#permission-clear-all");
    check(await selected("privilege"), []);
    const beforeEmpty = await sql();
    await add();
    check(await planCount(), "3");
    check(await sql(), beforeEmpty);
    check(
      await page.$eval(
        "#form-error",
        (e) => !e.hidden && /at least one/i.test(e.textContent),
      ),
    );
    await choose("privilege", "ALL PRIVILEGES");
    check(await selected("privilege"), ["ALL PRIVILEGES"]);
    await add();
    check(await page.$eval("#form-error", (e) => e.hidden));
    check((await sql()).includes("GRANT ALL PRIVILEGES ON TABLE"));
    await choose("privilege", "SELECT");
    check(await selected("privilege"), ["SELECT"]);
    await choose("privilege", "UPDATE");
    await switchType("sequence");
    check(await selected("privilege"), ["SELECT", "UPDATE"]);
    await switchType("function");
    check(await selected("privilege"), []);
    await add();
    check(await planCount(), "4");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await focus("[name=privilege][value=EXECUTE]");
    await page.keyboard.press("Space");
    check(await selected("privilege"), ["EXECUTE"]);
    await switchType("procedure");
    check(await selected("privilege"), ["EXECUTE"]);
    await choose("privilege", "ALL PRIVILEGES");
    await switchType("routine");
    check(await selected("privilege"), []);
    await click("#reset-form");
    check(await selected("objtype"), ["table"]);
    check(await selected("privilege"), ["SELECT"]);
    check(await planCount(), "4");
    // Defaults use the same accessible controls and preserve valid intersections.
    await grants("default");
    await choose("privilege", "INSERT");
    await add();
    check(
      (await sql()).includes(
        'GRANT SELECT, INSERT ON TABLES TO "example_app";',
      ),
    );
    await click("#permission-clear-all");
    await add();
    check(await planCount(), "5");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await focus("#permission-select-all");
    await page.keyboard.press("Enter");
    check(await selected("privilege"), tableAll);
    check(
      await page.evaluate(() => document.activeElement.id),
      "permission-select-all",
    );
    await add();
    await choose("privilege", "ALL PRIVILEGES");
    check(await selected("privilege"), ["ALL PRIVILEGES"]);
    await switchType("schema");
    check(await selected("privilege"), []);
    check(await val("schemas"), "");
    await click("#permission-select-all");
    check(await selected("privilege"), ["USAGE", "CREATE"]);
    await click("#reset-form");
    check(await selected("privilege"), ["SELECT"]);
    check(await planCount(), "6");
    // Predefined choices are explicit, combinable, and separate from custom names.
    await operation("membership");
    check(await page.$eval("#builtin", (e) => e.tagName), "FIELDSET");
    check(await selected("builtin"), []);
    check(await val("roles"), "");
    await add();
    check(
      await page.$eval(
        "#form-error",
        (e) =>
          !e.hidden && e.textContent.includes("at least one predefined role"),
      ),
    );
    check(await planCount(), "6");
    check(
      await page.$eval(
        "[name=builtin][value=pg_database_owner]",
        (e) => e.disabled,
      ),
    );
    await focus("[name=builtin][value=pg_monitor]");
    await page.keyboard.press("Space");
    await choose("builtin", "pg_read_all_settings");
    check(await selected("builtin"), ["pg_monitor", "pg_read_all_settings"]);
    check(
      await page.$eval("#builtin-info", (e) =>
        e.textContent.includes("Monitoring views"),
      ),
    );
    await add();
    check(
      (await sql()).includes(
        'GRANT "pg_monitor", "pg_read_all_settings" TO "example_app" WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;',
      ),
    );
    check(await planCount(), "7");
    check(await page.$eval("#form-error", (e) => e.hidden));
    await set("roles", "example_access, pg_monitor");
    await add();
    check(
      (await sql()).includes(
        'GRANT "example_access", "pg_monitor", "pg_read_all_settings" TO "example_app"',
      ),
    );
    check((await sql()).includes('"pg_monitor", "pg_monitor"'), false);
    const membershipPlan = await sql();
    await click("#builtin-select-all");
    check((await selected("builtin")).length, 14);
    check(
      await page.$$eval("[name=builtin]:disabled", (els) =>
        els.every((e) => !e.checked),
      ),
    );
    check(await sql(), membershipPlan);
    await focus("#builtin-clear-all");
    await page.keyboard.press("Space");
    check(await selected("builtin"), []);
    check(await val("roles"), "example_access, pg_monitor");
    await add();
    check(await planCount(), "9");
    await choose("builtin", "pg_monitor");
    await choose("builtin", "pg_read_all_stats");
    await set("roles", "custom_draft");
    await grants("object");
    await set("grantees", "other_draft");
    await click("#reset-form");
    await operation("membership");
    check(await selected("builtin"), ["pg_monitor", "pg_read_all_stats"]);
    check(await val("roles"), "custom_draft");
    const beforeReset = await sql();
    await click("#reset-form");
    check(await selected("builtin"), []);
    check(await val("roles"), "");
    check(await page.$eval("#builtin-info", (e) => e.textContent), "");
    check(await sql(), beforeReset);
    // Unsupported choices never become grantable through bulk selection.
    for (const platform of ["postgres", "aurora"])
      for (const version of [14, 15, 16, 17]) {
        await page.select("#platform", platform);
        await page.select("#version", String(version));
        const totals = { 14: 11, 15: 12, 16: 14, 17: 15 };
        check(
          await page.$$eval("[name=builtin]", (els) => els.length),
          totals[version],
        );
        check(await selected("builtin"), []);
        await click("#builtin-select-all");
        check(
          (await selected("builtin")).length,
          totals[version] - (platform === "aurora" ? 4 : 1),
        );
        check(
          await page.$$eval("[name=builtin]:disabled", (els) =>
            els.every((e) => !e.checked),
          ),
        );
        check(
          await page.$("[name=builtin][value=pg_maintain]").then(Boolean),
          version === 17,
        );
        check(
          await page.$("[name=builtin][value=pg_checkpoint]").then(Boolean),
          version >= 15,
        );
        check(
          await page
            .$("[name=builtin][value=pg_create_subscription]")
            .then(Boolean),
          version >= 16,
        );
        await click("#builtin-clear-all");
        check(await selected("builtin"), []);
        await choose("builtin", "pg_monitor");
        await click("#reset-form");
        check(await selected("builtin"), []);
      }
    // Even DOM tampering cannot bypass generator platform safeguards.
    await page.$eval("[name=builtin][value=pg_execute_server_program]", (e) => {
      e.disabled = false;
      e.checked = true;
    });
    await add();
    check(
      await page.$eval(
        "#form-error",
        (e) => !e.hidden && e.textContent.includes("unavailable on Aurora"),
      ),
    );
    check(await planCount(), "9");
    await click("#reset-form");
    check(
      await page.$eval(
        "[name=builtin][value=pg_execute_server_program]",
        (e) => e.disabled,
      ),
    );
    for (const version of [14, 15, 16, 17]) {
      await page.select("#version", String(version));
      await grants("object");
      check(await selected("privilege"), ["SELECT"]);
      await click("#permission-select-all");
      check((await selected("privilege")).length, version === 17 ? 8 : 7);
      check((await selected("privilege")).includes("MAINTAIN"), version === 17);
      check(await page.$("#type-parameter").then(Boolean), version >= 15);
      await switchType("column");
      check(await selected("privilege"), [
        "SELECT",
        "INSERT",
        "UPDATE",
        "REFERENCES",
      ]);
      await click("#permission-clear-all");
      await click("#reset-form");
      check(await selected("privilege"), ["SELECT"]);
    }
    // Multi-type grants: one Add emits one statement per type, filtered per type.
    await grants("object");
    await click("#reset-form");
    await click("#type-sequence");
    check(await selected("objtype"), ["table", "sequence"]);
    check(
      await page.$$eval("[name=privilege]", (els) => els.map((e) => e.value)),
      [...tableAll, "USAGE", "ALL PRIVILEGES"],
    );
    check(await selected("privilege"), ["SELECT"]);
    await page.select("#scope", "all");
    check(await val("schemas"), "example_schema");
    await choose("privilege", "USAGE");
    check(await selected("privilege"), ["SELECT", "USAGE"]);
    const beforeMulti = Number(await planCount());
    await add();
    check(await planCount(), String(beforeMulti + 1));
    check(
      (await sql()).includes(
        'GRANT SELECT ON ALL TABLES IN SCHEMA "example_schema" TO "example_app";\nGRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA "example_schema" TO "example_app";',
      ),
    );
    await page.$eval(
      "#plan-list > li:last-child details",
      (e) => (e.open = true),
    );
    check(
      await page.$eval("#plan-list > li:last-child", (e) =>
        e.textContent.includes("SELECT, USAGE on all existing SEQUENCES"),
      ),
    );
    await choose("privilege", "SELECT");
    check(await selected("privilege"), ["USAGE"]);
    await add();
    check(
      await page.$eval("#form-error", (e) =>
        e.textContent.includes(
          "None of the selected permissions apply to Table",
        ),
      ),
    );
    check(await planCount(), String(beforeMulti + 1));
    // Types that need their own fields are exclusive.
    await click("#type-column");
    check(await selected("objtype"), ["column"]);
    check(await page.$("#columns").then(Boolean));
    await click("#type-table");
    check(await selected("objtype"), ["table"]);
    await click("#type-database");
    check(await page.$("#scope"), null);
    await click("#type-database");
    await click("#type-table");
    check(await selected("objtype"), []);
    check(await page.$("#permissions-empty").then(Boolean));
    await add();
    check(
      await page.$eval("#form-error", (e) =>
        e.textContent.includes("Select at least one object type"),
      ),
    );
    await click("#type-table");
    await click("#type-routine");
    await add();
    check(
      await page.$eval("#form-error", (e) =>
        e.textContent.includes("exact overload"),
      ),
    );
    // Each toggle side keeps its own draft; Reset clears only the visible side.
    await set("grantees", "existing_draft");
    await grants("default");
    check(
      await page.$eval("#grant-mode-default", (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    );
    check(await page.$("#scope"), null);
    check(await page.$eval("#creators", (e) => e.placeholder), "example_owner");
    check(await page.$eval("#schemas", (e) => e.placeholder), "example_schema");
    check(await page.$("#type-database"), null);
    await click("#type-sequence");
    await set("creators", "future_draft");
    await grants("object");
    check(await val("grantees"), "existing_draft");
    check(await selected("objtype"), ["table", "routine"]);
    await operation("profile");
    await grants("default");
    check(await val("creators"), "future_draft");
    check(await selected("objtype"), ["table", "sequence"]);
    await add();
    check(
      (await sql()).includes(
        'ALTER DEFAULT PRIVILEGES FOR ROLE "future_draft"\n  GRANT SELECT ON TABLES TO "example_app";\nALTER DEFAULT PRIVILEGES FOR ROLE "future_draft"\n  GRANT SELECT ON SEQUENCES TO "example_app";',
      ),
    );
    await click("#reset-form");
    check(await val("creators"), "");
    await grants("object");
    check(await val("grantees"), "existing_draft");
    await click("#reset-form");
    check(await val("grantees"), "example_app");
    // Responsive screenshots show real controls, not just generated markup.
    await choose("privilege", "INSERT");
    await choose("privilege", "UPDATE");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "checkbox-desktop.png"),
      fullPage: true,
    });
    await operation("membership");
    await choose("builtin", "pg_monitor");
    await choose("builtin", "pg_read_all_settings");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "checkbox-desktop-roles.png"),
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval("#builtin", (e) => e.scrollIntoView({ block: "start" }));
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    check(
      await page.$eval(
        "#builtin-select-all",
        (e) => e.getBoundingClientRect().width > 0,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "checkbox-mobile-roles.png"),
    });
    await grants("object");
    await page.$eval("#permission", (e) =>
      e.scrollIntoView({ block: "center" }),
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "checkbox-mobile-permissions.png"),
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "networkidle0" });
    await operation("membership");
    await choose("builtin", "pg_monitor");
    await choose("builtin", "pg_read_all_settings");
    await add();
    check(await planCount(), "1");
    check(
      (await sql()).includes('GRANT "pg_monitor", "pg_read_all_settings" TO'),
    );
    check(errors, []);
    check(external, []);
    console.log(
      `PASS: ${count} checkbox browser checks on ${await browser.version()}. Multi-type and multi-permission/default/role SQL, toggle drafts, bulk controls, ALL exclusivity, empty choices, supported majors/platforms, disabled safeguards, draft/reset preservation, keyboard focus, offline use and mobile layout.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
