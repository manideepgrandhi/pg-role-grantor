const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const artifacts =
    process.env.ARTIFACTS || "/workspace/pg-role-grantor-artifacts/review";
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let count = 0;
  const check = (a, b = true) => {
    assert.deepEqual(a, b);
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
    await browser
      .defaultBrowserContext()
      .overridePermissions(new URL(url).origin, [
        "clipboard-read",
        "clipboard-sanitized-write",
      ]);
    await page.goto(url, { waitUntil: "networkidle0" });
    // One review list: each plan item is a details element with its lines.
    const summary = () => page.$eval("#plan-list", (e) => e.textContent);
    const sql = () => page.$eval("#sql-code", (e) => e.textContent);
    const verifySql = () => page.$eval("#verify-code", (e) => e.textContent);
    const set = (id, value) =>
      page.$eval("#" + id, (e, v) => (e.value = v), value);
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
    const tab = async (name) => {
      const grant = name === "object" || name === "default";
      await page.select("#operation", grant ? "grants" : name);
      if (grant) await click("#grant-mode-" + name);
    };
    const switchType = async (key) => {
      await click("#type-" + key);
      for (const other of await page.$$eval("[name=objtype]:checked", (els) =>
        els.map((e) => e.value),
      ))
        if (other !== key) await click("#type-" + other);
    };
    const add = () => page.click("button[type=submit]");
    const items = () => page.$$eval("#plan-list > li", (els) => els.length);
    check(await items(), 0);
    check(await page.$eval("#empty-plan", (e) => !e.hidden));
    check(
      await page.$$eval("#permission-summary,[name=sql-mode]", (e) => e.length),
      0,
    );
    check(await page.$eval("#verification", (e) => e.tagName), "DETAILS");
    check(await page.$eval("#verification", (e) => e.open), false);
    await set("group", "draft_only");
    check((await summary()).includes("draft_only"), false);
    await click("#reset-form");
    await set("members", "example_app");
    await add();
    check(await items(), 1);
    check(await page.$eval("#plan-list details", (e) => e.open), false);
    await click("#plan-list summary");
    const profileText = await summary();
    for (const text of [
      "example_writer",
      "example_db",
      "example_schema",
      "SELECT, INSERT, UPDATE, DELETE, TRUNCATE on all existing TABLES",
      "SELECT, USAGE on all existing SEQUENCES",
      "EXECUTE on all existing FUNCTIONS",
      "USAGE on future TYPES",
      "no creators listed",
      "CURRENT_USER",
      "executing role",
      "example_app",
      "NOLOGIN",
      "SET false",
    ])
      check(profileText.includes(text), true);
    check(
      await page.$eval("#warnings", (e) =>
        e.textContent.includes("not by other owner or creator roles"),
      ),
    );
    await tab("object");
    await click("[name=privilege][value=UPDATE]");
    await click("details.field summary");
    await click("#grantOption");
    await add();
    check(await items(), 2);
    check((await summary()).includes("WITH GRANT OPTION"));
    await tab("default");
    await switchType("type");
    await click("[name=privilege][value=USAGE]");
    await page.select("#action", "revoke");
    await click("#public");
    await set("schemas", "");
    await set("creators", "example_owner,example_builder");
    await add();
    check(await items(), 3);
    check((await summary()).includes("REVOKE USAGE"));
    check(
      (await summary()).includes(
        "creators example_owner, example_builder; database-global",
      ),
    );
    check((await summary()).includes("PUBLIC (every role)"));
    await tab("membership");
    await click("[name=builtin][value=pg_monitor]");
    await click("[name=builtin][value=pg_read_all_settings]");
    await add();
    check(await items(), 4);
    check(
      (await summary()).includes(
        "pg_monitor, pg_read_all_settings to example_app",
      ),
    );
    await tab("group");
    await set("group", "example_new_group");
    await add();
    check(await items(), 5);
    check((await summary()).includes("example_new_group"));
    await tab("fdw");
    await add();
    check(await items(), 6);
    const fdwText = await summary();
    for (const text of [
      "example_app → remote user example_remote_reader",
      "example_importer",
      "LIMIT TO example_items",
      "foreign server example_server",
      "CREATE on SCHEMA example_foreign",
      "remote.example.invalid:5432/example_remote_db",
    ])
      check(fdwText.includes(text));
    const setup = await sql();
    await set("host", "draft.example.invalid");
    check((await summary()).includes("draft.example.invalid"), false);
    // Verification SQL sits in its own disclosure and never swaps the setup preview.
    await page.focus("#verification summary");
    await page.keyboard.press("Enter");
    check(await page.$eval("#verification", (e) => e.open));
    const verification = await verifySql();
    check(await sql(), setup);
    check(verification !== setup);
    check(verification.includes("READ-ONLY verification"));
    check(verification.includes("pg_catalog.pg_default_acl"));
    check(verification.includes("pg_catalog.pg_auth_members"));
    check(verification.includes("pg_catalog.pg_user_mapping"));
    check(verification.includes("(VALUES (CURRENT_USER::text)) wanted(name)"));
    check(verification.includes("PASSWORD_HEX"), false);
    check(/\bumoptions\b/.test(verification), false);
    check(await page.$eval("#host", (e) => e.value), "draft.example.invalid");
    await click("#verify-copy");
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("Verification SQL copied"),
    );
    check(
      await page.evaluate(() => navigator.clipboard.readText()),
      verification,
    );
    await click("#copy");
    await page.waitForFunction(() =>
      document
        .querySelector("#status")
        .textContent.includes("Setup SQL copied"),
    );
    check(await page.evaluate(() => navigator.clipboard.readText()), setup);
    const downloads = fs.mkdtempSync(path.join(artifacts, "downloads-"));
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    const download = async (button, name, expected) => {
      const complete = new Promise((resolve, reject) => {
        const watcher = fs.watch(downloads, () => {
          const p = path.join(downloads, name);
          if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === expected) {
            clearTimeout(timer);
            watcher.close();
            resolve();
          }
        });
        const timer = setTimeout(() => {
          watcher.close();
          reject(Error("Download missing or differs: " + name));
        }, 7000);
      });
      await click(button);
      await complete;
      check(fs.readFileSync(path.join(downloads, name), "utf8"), expected);
    };
    await download(
      "#verify-download",
      "permission-verification.sql",
      verification,
    );
    await download("#download", "permission-plan.sql", setup);
    check(await items(), 6);
    await tab("profile");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "review-desktop.png"),
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval(".preview", (e) => e.scrollIntoView({ block: "start" }));
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    check(
      await page.$eval("#verify-copy", (e) =>
        e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "review-mobile.png") });
    await page.setViewport({ width: 1440, height: 1100 });
    await click('[aria-label="Remove operation 2"]');
    check(await items(), 5);
    check((await summary()).includes("WITH GRANT OPTION"), false);
    check((await verifySql()).includes('"action":"revoke"'));
    await tab("fdw");
    const beforeCancel = { summary: await summary(), sql: await sql() };
    page.once("dialog", (dialog) => dialog.dismiss());
    await click("#clear");
    check({ summary: await summary(), sql: await sql() }, beforeCancel);
    page.once("dialog", (dialog) => dialog.accept());
    await click("#clear");
    check(await items(), 0);
    check(await page.$eval("#empty-plan", (e) => !e.hidden));
    check(await page.$eval("#download", (e) => e.disabled));
    check(await page.$eval("#verify-download", (e) => e.disabled));
    check(await page.$eval("#verification", (e) => e.open));
    check(await page.$eval("#host", (e) => e.value), "draft.example.invalid");
    await page.select("#version", "14");
    await tab("membership");
    await click("[name=builtin][value=pg_monitor]");
    await add();
    check((await verifySql()).includes("a.inherit_option"), false);
    check((await summary()).includes("inheritance follows member INHERIT"));
    const summary14 = await summary();
    const sql14 = await verifySql();
    await click("#reset-form");
    check(await summary(), summary14);
    check(await verifySql(), sql14);
    await page.select("#version", "17");
    check((await verifySql()).includes("a.inherit_option"));
    await tab("object");
    await click("#permission-clear-all");
    await click("[name=privilege][value=MAINTAIN]");
    await add();
    check(await items(), 2);
    await page.select("#version", "14");
    check(await page.$eval("#download", (e) => e.disabled));
    check(await page.$eval("#verify-download", (e) => e.disabled));
    check(
      await page.$eval(
        "#plan-error",
        (e) => !e.hidden && e.textContent.includes("incompatible"),
      ),
    );
    check(await items(), 2);
    await page.select("#version", "17");
    check(await page.$eval("#download", (e) => e.disabled), false);
    check(await items(), 2);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "networkidle0" });
    await tab("group");
    await set("group", "example_<img>");
    await add();
    check((await summary()).includes("example_<img>"));
    check(await page.$$eval("#plan-list img", (els) => els.length), 0);
    check((await verifySql()).includes("READ-ONLY verification"));
    check((await verifySql()).includes("example_<img>"));
    check(await items(), 1);
    check(errors, []);
    check(external, []);
    console.log(
      `PASS: ${count} summary/verification browser checks on ${await browser.version()}. Every operation, one expandable review list, blank-creator wording, exact recipients/scopes/options, ordered removal/clear, drafts excluded, verification disclosure, clipboard and separate downloaded bytes, version handling, reset, mobile, keyboard, offline and inert text.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
