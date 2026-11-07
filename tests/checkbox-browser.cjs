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
    const choose = (name, value) =>
      page.click(`[name=${name}][value="${value}"]`);
    const set = (id, value) =>
      page.$eval("#" + id, (e, v) => (e.value = v), value);
    const val = (id) => page.$eval("#" + id, (e) => e.value);
    const add = () => page.click("button[type=submit]");
    const planCount = () => page.$eval("#plan-count", (e) => e.textContent);
    await add();
    await page.click("#tab-object");
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
    await page.click("#permission-select-all");
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
    await page.click("#permission-clear-all");
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
    await page.select("#object", "sequence");
    check(await selected("privilege"), ["SELECT", "UPDATE"]);
    await page.select("#object", "function");
    check(await selected("privilege"), []);
    await add();
    check(await planCount(), "4");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await page.focus("[name=privilege][value=EXECUTE]");
    await page.keyboard.press("Space");
    check(await selected("privilege"), ["EXECUTE"]);
    await page.select("#object", "procedure");
    check(await selected("privilege"), ["EXECUTE"]);
    await choose("privilege", "ALL PRIVILEGES");
    await page.select("#object", "routine");
    check(await selected("privilege"), []);
    await page.click("#reset-form");
    check(await val("object"), "table");
    check(await selected("privilege"), ["SELECT"]);
    check(await planCount(), "4");
    // Defaults use the same accessible controls and preserve valid intersections.
    await page.click("#tab-default");
    await choose("privilege", "INSERT");
    await add();
    check(
      (await sql()).includes(
        'GRANT SELECT, INSERT ON TABLES TO "example_app";',
      ),
    );
    await page.click("#permission-clear-all");
    await add();
    check(await planCount(), "5");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await page.focus("#permission-select-all");
    await page.keyboard.press("Enter");
    check(await selected("privilege"), tableAll);
    check(
      await page.evaluate(() => document.activeElement.id),
      "permission-select-all",
    );
    await add();
    await choose("privilege", "ALL PRIVILEGES");
    check(await selected("privilege"), ["ALL PRIVILEGES"]);
    await page.select("#object", "schema");
    check(await selected("privilege"), []);
    check(await val("schemas"), "");
    await page.click("#permission-select-all");
    check(await selected("privilege"), ["USAGE", "CREATE"]);
    await page.click("#reset-form");
    check(await selected("privilege"), ["SELECT"]);
    check(await planCount(), "6");
    // Predefined choices are explicit, combinable, and separate from custom names.
    await page.click("#tab-membership");
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
    await page.focus("[name=builtin][value=pg_monitor]");
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
    await page.click("#builtin-select-all");
    check((await selected("builtin")).length, 14);
    check(
      await page.$$eval("[name=builtin]:disabled", (els) =>
        els.every((e) => !e.checked),
      ),
    );
    check(await sql(), membershipPlan);
    await page.focus("#builtin-clear-all");
    await page.keyboard.press("Space");
    check(await selected("builtin"), []);
    check(await val("roles"), "example_access, pg_monitor");
    await add();
    check(await planCount(), "9");
    await choose("builtin", "pg_monitor");
    await choose("builtin", "pg_read_all_stats");
    await set("roles", "custom_draft");
    await page.click("#tab-object");
    await set("grantees", "other_draft");
    await page.click("#reset-form");
    await page.click("#tab-membership");
    check(await selected("builtin"), ["pg_monitor", "pg_read_all_stats"]);
    check(await val("roles"), "custom_draft");
    const beforeReset = await sql();
    await page.click("#reset-form");
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
        await page.click("#builtin-select-all");
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
        await page.click("#builtin-clear-all");
        check(await selected("builtin"), []);
        await choose("builtin", "pg_monitor");
        await page.click("#reset-form");
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
    await page.click("#reset-form");
    check(
      await page.$eval(
        "[name=builtin][value=pg_execute_server_program]",
        (e) => e.disabled,
      ),
    );
    for (const version of [14, 15, 16, 17]) {
      await page.select("#version", String(version));
      await page.click("#tab-object");
      check(await selected("privilege"), ["SELECT"]);
      await page.click("#permission-select-all");
      check((await selected("privilege")).length, version === 17 ? 8 : 7);
      check((await selected("privilege")).includes("MAINTAIN"), version === 17);
      check(
        await page.$eval("#object", (e) =>
          [...e.options].some((o) => o.value === "parameter"),
        ),
        version >= 15,
      );
      await page.select("#object", "column");
      check(await selected("privilege"), [
        "SELECT",
        "INSERT",
        "UPDATE",
        "REFERENCES",
      ]);
      await page.click("#permission-clear-all");
      await page.click("#reset-form");
      check(await selected("privilege"), ["SELECT"]);
    }
    // Responsive screenshots show real controls, not just generated markup.
    await choose("privilege", "INSERT");
    await choose("privilege", "UPDATE");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "checkbox-desktop.png"),
      fullPage: true,
    });
    await page.click("#tab-membership");
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
    await page.click("#tab-object");
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
    await page.click("#tab-membership");
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
      `PASS: ${count} checkbox browser checks on ${await browser.version()}. Multi-permission/default/role SQL, bulk controls, ALL exclusivity, empty choices, supported majors/platforms, disabled safeguards, draft/reset preservation, keyboard focus, offline use and mobile layout.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
