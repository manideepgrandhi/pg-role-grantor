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
    const summary = () =>
      page.$eval("#permission-summary", (e) => e.textContent);
    const sql = () => page.$eval("#sql-code", (e) => e.textContent);
    const set = (id, value) =>
      page.$eval("#" + id, (e, v) => (e.value = v), value);
    const tab = (name) => page.click("#tab-" + name);
    const add = () => page.click("button[type=submit]");
    const items = () =>
      page.$$eval("#permission-summary>details", (els) => els.length);
    check(await items(), 0);
    check((await summary()).includes("No queued operations"));
    await set("group", "draft_only");
    check((await summary()).includes("draft_only"), false);
    await page.click("#reset-form");
    await add();
    check(await items(), 1);
    await page.click("#permission-summary summary");
    const profileText = await summary();
    for (const text of [
      "example_writer",
      "example_db",
      "example_schema",
      "SELECT, INSERT, UPDATE, DELETE",
      "sequence",
      "example_owner",
      "example_app",
      "NOLOGIN",
      "SET false",
    ])
      check(profileText.toLowerCase().includes(text.toLowerCase()));
    await tab("object");
    await page.click("[name=privilege][value=UPDATE]");
    await page.click("details.field summary");
    await page.click("#grantOption");
    await add();
    check(await items(), 2);
    check((await summary()).includes("WITH GRANT OPTION"));
    await tab("default");
    await page.select("#object", "type");
    await page.click("[name=privilege][value=USAGE]");
    await page.select("#action", "revoke");
    await page.click("#public");
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
    await page.click("[name=builtin][value=pg_monitor]");
    await page.click("[name=builtin][value=pg_read_all_settings]");
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
    await page.focus("#mode-setup");
    await page.keyboard.press("ArrowRight");
    check(
      await page.evaluate(() => document.activeElement.id),
      "mode-verification",
    );
    check(await page.$eval("#mode-verification", (e) => e.checked));
    const verification = await sql();
    check(verification !== setup);
    check(verification.includes("READ-ONLY verification"));
    check(verification.includes("pg_catalog.pg_default_acl"));
    check(verification.includes("pg_catalog.pg_auth_members"));
    check(verification.includes("pg_catalog.pg_user_mapping"));
    check(verification.includes("PASSWORD_HEX"), false);
    check(/\bumoptions\b/.test(verification), false);
    check(await page.$eval("#host", (e) => e.value), "draft.example.invalid");
    check(
      await page.$eval("#file-label", (e) => e.textContent),
      "permission-verification.sql",
    );
    check(await page.$eval("#verification-help", (e) => e.hidden), false);
    check(
      await page.$eval("#copy", (e) => e.getAttribute("aria-label")),
      "Copy verification SQL",
    );
    await page.click("#copy");
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("copied"),
    );
    check(
      await page.evaluate(() => navigator.clipboard.readText()),
      verification,
    );
    const downloads = fs.mkdtempSync(path.join(artifacts, "downloads-"));
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    const download = async (name, expected) => {
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
      await page.click("#download");
      await complete;
      check(fs.readFileSync(path.join(downloads, name), "utf8"), expected);
    };
    await download("permission-verification.sql", verification);
    await page.click("#mode-setup");
    check(await sql(), setup);
    check(
      await page.$eval("#file-label", (e) => e.textContent),
      "permission-plan.sql",
    );
    await download("permission-plan.sql", setup);
    await page.click("#mode-verification");
    check(await sql(), verification);
    check(await items(), 6);
    await tab("profile");
    await page.click("#permission-summary details:first-child summary");
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
      await page.$eval("#mode-verification", (e) =>
        e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "review-mobile.png") });
    await page.setViewport({ width: 1440, height: 1100 });
    await page.click('[aria-label="Remove operation 2"]');
    check(await items(), 5);
    check((await summary()).includes("WITH GRANT OPTION"), false);
    check((await sql()).includes('"action":"revoke"'));
    await tab("fdw");
    const beforeCancel = { summary: await summary(), sql: await sql() };
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.click("#clear");
    check({ summary: await summary(), sql: await sql() }, beforeCancel);
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clear");
    check(await items(), 0);
    check((await summary()).includes("No queued operations"));
    check(await page.$eval("#download", (e) => e.disabled));
    check(await page.$eval("#mode-verification", (e) => e.checked));
    check(await page.$eval("#host", (e) => e.value), "draft.example.invalid");
    await page.select("#version", "14");
    await tab("membership");
    await page.click("[name=builtin][value=pg_monitor]");
    await add();
    check((await sql()).includes("a.inherit_option"), false);
    check((await summary()).includes("inheritance follows member INHERIT"));
    const summary14 = await summary();
    const sql14 = await sql();
    await page.click("#reset-form");
    check(await summary(), summary14);
    check(await sql(), sql14);
    await page.select("#version", "17");
    check((await sql()).includes("a.inherit_option"));
    await tab("object");
    await page.click("#permission-clear-all");
    await page.click("[name=privilege][value=MAINTAIN]");
    await add();
    check(await items(), 2);
    await page.select("#version", "14");
    check(await page.$eval("#download", (e) => e.disabled));
    check((await summary()).includes("incompatible"));
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
    check(await page.$$eval("#permission-summary img", (els) => els.length), 0);
    await page.click("#mode-verification");
    check((await sql()).includes("READ-ONLY verification"));
    check((await sql()).includes("example_<img>"));
    check(await items(), 1);
    check(errors, []);
    check(external, []);
    console.log(
      `PASS: ${count} summary/verification browser checks on ${await browser.version()}. All six panes, exact recipients/scopes/options, ordered removal/clear, drafts excluded, read-only mode, clipboard and separate downloaded bytes, version handling, reset, mobile, keyboard, offline and inert text.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
