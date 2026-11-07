const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const artifacts =
    process.env.ARTIFACTS || "/workspace/pg-role-grantor-artifacts/reset";
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
      externalRequests = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (request) => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== new URL(url).origin
      )
        externalRequests.push(request.url());
    });
    await page.goto(url, { waitUntil: "networkidle0" });
    const val = (id) => page.$eval("#" + id, (e) => e.value);
    const set = (id, value) =>
      page.$eval("#" + id, (e, v) => (e.value = v), value);
    const tab = (name) => page.click("#tab-" + name);
    const has = (id) => page.$("#" + id).then(Boolean);
    const checked = (id) => page.$eval("#" + id, (e) => e.checked);
    const snapshot = () =>
      page.evaluate(() => ({
        values: [
          ...document.querySelectorAll(
            "#operation-form input,#operation-form select,#operation-form textarea",
          ),
        ].map((e) => [e.id, e.value, e.checked, e.disabled]),
        sql: document.querySelector("#sql-code").textContent,
        count: document.querySelector("#plan-count").textContent,
        platform: document.querySelector("#platform").value,
        version: document.querySelector("#version").value,
        status: document.querySelector("#status").textContent,
        feedback: document.querySelector("#form-feedback").textContent,
      }));
    await page.select("#platform", "aurora");
    await page.select("#version", "14");
    await page.click("button[type=submit]");
    const queuedSQL = await page.$eval("#sql-code", (e) => e.textContent);
    const reset = async () => {
      await page.click("#reset-form");
      check(await page.$eval("#sql-code", (e) => e.textContent), queuedSQL);
      check(await page.$eval("#plan-count", (e) => e.textContent), "1");
      check([await val("platform"), await val("version")], ["aurora", "14"]);
      check(
        await page.$eval(
          "#form-error",
          (e) => e.hidden && e.textContent === "",
        ),
      );
      check(await page.$eval("#status", (e) => e.textContent), "");
      check(await page.evaluate(() => document.activeElement.id), "reset-form");
    };
    // Keep a profile draft while resetting an unrelated, invalid object form.
    await page.click("[data-profile=reader]");
    await set("group", "profile_draft");
    await set("database", "draft_db");
    await tab("object");
    await page.select("#object", "column");
    await set("grantees", "object_draft");
    await set("columns", "private_column");
    await page.select("#action", "revoke");
    await page.click("#public");
    await page.click("details.field summary");
    await page.click("#optionOnly");
    await page.select("#behavior", "CASCADE");
    await set("targets", "");
    await page.click("button[type=submit]");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await reset();
    check(await val("object"), "table");
    check(await val("action"), "grant");
    check(await val("grantees"), "example_app");
    check(await checked("public"), false);
    check(await checked("optionOnly"), false);
    check(await val("behavior"), "RESTRICT");
    check(
      await page.$$eval("[name=privilege]:checked", (els) =>
        els.map((e) => e.value),
      ),
      ["SELECT"],
    );
    check(
      await page.$$eval("[name=privilege]", (els) =>
        els.some((e) => e.value === "MAINTAIN"),
      ),
      false,
    );
    await tab("profile");
    check(await val("group"), "profile_draft");
    check(await val("database"), "draft_db");
    check(
      await page.$eval("[data-profile=reader]", (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    );
    // Each pane resets its own dynamic state, without replacing other drafts.
    await tab("default");
    await page.select("#object", "schema");
    await set("creators", "creator_draft");
    await set("schemas", "invalid_nested_schema");
    await page.click("button[type=submit]");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await reset();
    check(await val("object"), "table");
    check(await val("creators"), "example_owner");
    check(await val("schemas"), "example_schema");
    await tab("membership");
    await page.click('[name=builtin][value="pg_monitor"]');
    await page.select("#action", "revoke");
    await page.select("#revokeOption", "ADMIN");
    await page.select("#behavior", "CASCADE");
    await set("members", "member_draft");
    await reset();
    check(await page.$$eval("[name=builtin]:checked", (els) => els.length), 0);
    check(await val("roles"), "");
    check(await val("members"), "example_app");
    check(await val("action"), "grant");
    check(await checked("admin"), false);
    check(await has("inherit"), false);
    check(await has("set"), false);
    await tab("group");
    await set("group", "");
    await page.click("button[type=submit]");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await reset();
    check(await val("group"), "example_access");
    await tab("profile");
    check(await val("group"), "profile_draft");
    await reset();
    check(await val("group"), "example_writer");
    check(await val("database"), "example_db");
    check(
      await page.$eval("[data-profile=writer]", (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    );
    // FDW drafts keep listeners and independent mapping/column IDs across tab resets.
    await tab("fdw");
    await set("host", "edited.example.invalid");
    await set("port", "6543");
    await page.click("#add-mapping");
    await page.select("#mode", "manual");
    await page.click("#add-column");
    await set("localTable", "manual_draft");
    await page.select("#sslmode", "disable");
    await tab("object");
    await set("grantees", "object_changed_again");
    await reset();
    await tab("fdw");
    check(await val("mode"), "manual");
    check(await val("host"), "edited.example.invalid");
    check(await val("port"), "6543");
    check(await val("localTable"), "manual_draft");
    check(await page.$$eval(".mapping-row", (els) => els.length), 3);
    check(await page.$$eval(".column-row", (els) => els.length), 3);
    await page.click("#add-mapping");
    check(await page.$$eval(".mapping-row", (els) => els.length), 4);
    check(
      await page.$$eval(
        "#operation-panel [id]",
        (els) => new Set(els.map((e) => e.id)).size === els.length,
      ),
    );
    await set("port", "invalid");
    await page.click("button[type=submit]");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    await reset();
    check(await val("mode"), "import");
    check(await val("sslmode"), "verify-full");
    check(await page.$eval("#sslrootcert", (e) => e.disabled), false);
    check(await val("host"), "remote.example.invalid");
    check(await val("port"), "5432");
    check(await val("importAs"), "example_importer");
    check(await val("importFilter"), "limit");
    check(await val("tables"), "example_items");
    check(await page.$$eval(".mapping-row", (els) => els.length), 2);
    check(await page.$$eval(".column-row", (els) => els.length), 0);
    check(
      await page.$$eval(".mapping-row input", (els) => els.map((e) => e.value)),
      [
        "example_app",
        "example_remote_reader",
        "example_importer",
        "example_remote_reader",
      ],
    );
    await page.select("#mode", "manual");
    check(
      await page.$$eval(".column-row input:not([type=checkbox])", (els) =>
        els.map((e) => e.value),
      ),
      ["id", "integer", "", "description", "text", ""],
    );
    await reset();
    await page.select("#importFilter", "exclude");
    await set("tables", "private_table");
    await page.$eval(".mapping-row:last-child .remove-row", (e) => e.click());
    await reset();
    check(await page.$$eval(".mapping-row", (els) => els.length), 2);
    check(await val("importFilter"), "limit");
    check(await val("tables"), "example_items");
    // Keyboard activation retains focus and restores the active form only.
    await tab("profile");
    await set("group", "keyboard_draft");
    await page.focus("#reset-form");
    await page.keyboard.press("Enter");
    check(await val("group"), "example_writer");
    check(await page.evaluate(() => document.activeElement.id), "reset-form");
    await set("group", "space_draft");
    await page.keyboard.press("Space");
    check(await val("group"), "example_writer");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "reset-desktop.png"),
      fullPage: true,
    });
    // Clear plan cancellation changes neither queued SQL nor active form or engine.
    await set("group", "keep_this_form");
    const before = await snapshot();
    let prompt;
    page.once("dialog", async (dialog) => {
      prompt = { type: dialog.type(), message: dialog.message() };
      await dialog.dismiss();
    });
    await page.click("#clear");
    check(prompt.type, "confirm");
    check(prompt.message.includes("current form"));
    check(await snapshot(), before);
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clear");
    check(await page.$eval("#plan-count", (e) => e.textContent), "0");
    check(await val("group"), "keep_this_form");
    check([await val("platform"), await val("version")], ["aurora", "14"]);
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        "CREATE ROLE",
      ),
      false,
    );
    let unexpected = 0;
    const dismiss = (dialog) => {
      unexpected++;
      dialog.dismiss();
    };
    page.on("dialog", dismiss);
    await page.click("#clear");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    page.off("dialog", dismiss);
    check(unexpected, 0);
    // New engine versions rebuild defaults rather than restoring incompatible controls.
    await page.select("#version", "17");
    await tab("object");
    await page.select("#object", "parameter");
    await page.click("#reset-form");
    check(await val("object"), "table");
    check(
      await page.$$eval("[name=privilege]", (els) =>
        els.some((e) => e.value === "MAINTAIN"),
      ),
    );
    await tab("membership");
    await page.click("#inherit");
    await page.click("#set");
    await page.click("#admin");
    await page.click("#reset-form");
    check(
      [await checked("admin"), await checked("inherit"), await checked("set")],
      [false, true, true],
    );
    await page.select("#version", "14");
    await tab("object");
    await page.click("#reset-form");
    check(
      await page.$$eval("#object option", (els) =>
        els.some((e) => e.value === "parameter"),
      ),
      false,
    );
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval(".form-actions", (e) =>
      e.scrollIntoView({ block: "center" }),
    );
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    check(
      await page.$eval(
        "#reset-form",
        (e) => e.getBoundingClientRect().width > 0,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, "reset-mobile-controls.png"),
    });
    check(errors, []);
    check(externalRequests, []);
    console.log(
      `PASS: ${count} reset browser checks on ${await browser.version()}. Six panes, preserved drafts/SQL/engine, FDW rows and modes, validation cleanup, Enter/Space focus, version-aware defaults, Clear plan cancel/confirm/empty, and mobile layout.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
