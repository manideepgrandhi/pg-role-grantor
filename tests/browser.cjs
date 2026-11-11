const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const artifacts =
    process.env.ARTIFACTS || "/workspace/pg-role-grantor-artifacts";
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let checks = 0;
  const check = (a, b = true) => {
    assert.equal(a, b);
    checks++;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const external = [];
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(new URL(url).origin))
        external.push(r.url());
    });
    await browser
      .defaultBrowserContext()
      .overridePermissions(new URL(url).origin, [
        "clipboard-read",
        "clipboard-sanitized-write",
      ]);
    await page.goto(url, { waitUntil: "networkidle0" });
    const sql = () => page.$eval("#sql-code", (e) => e.textContent);
    const add = () => page.click("button[type=submit]");
    const operation = (value) => page.select("#operation", value);
    // Opens the More disclosure if needed, clears other types, and checks one.
    const onlyType = async (key) => {
      await page.$eval("#more-types", (e) => (e.open = true));
      for (const el of await page.$$("[name=objtype]:checked"))
        await el.click();
      await page.click("#type-" + key);
    };
    check(await page.title(), "PG role grantor · Permission scripts");
    check(
      await page.$eval("h1", (e) => e.textContent),
      "Build a permission script",
    );
    check(
      await page.$$eval("[role=tab],.tabs,.eyebrow,.badge", (e) => e.length),
      0,
    );
    check(
      JSON.stringify(
        await page.$$eval("#operation option", (els) =>
          els.map((e) => [e.value, e.textContent]),
        ),
      ),
      JSON.stringify([
        ["profile", "Access setup"],
        ["grants", "Grants"],
        ["membership", "Membership"],
        ["group", "Create role"],
        ["fdw", "FDW setup"],
      ]),
    );
    check(await page.$eval("#platform", (e) => e.value), "postgres");
    check(await page.$eval("#version", (e) => e.value), "17");
    check(await page.$eval("#download", (b) => b.disabled));
    // Optional fields start blank with a placeholder.
    for (const [id, placeholder] of [
      ["creators", "example_owner"],
      ["members", "example_app"],
    ]) {
      check(await page.$eval("#" + id, (e) => e.value), "");
      check(await page.$eval("#" + id, (e) => e.placeholder), placeholder);
    }
    await add();
    await page.waitForFunction(
      () => document.querySelector("#plan-count").textContent === "1",
    );
    const initial = await sql();
    check(initial.includes('CREATE ROLE "example_writer" NOLOGIN'));
    check(
      initial.includes(
        'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA "example_schema"',
      ),
    );
    check(initial.includes("GRANT SELECT, USAGE ON ALL SEQUENCES"));
    check(initial.includes("GRANT EXECUTE ON ALL FUNCTIONS"));
    check(initial.includes("GRANT USAGE ON TYPES"));
    check(initial.includes("FOR ROLE"), false);
    check(
      initial.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA "example_schema"'),
    );
    check(initial.includes("WITH ADMIN"), false);
    await page.click("#copy");
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("copied"),
    );
    check(await page.evaluate(() => navigator.clipboard.readText()), initial);
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: artifacts,
    });
    const target = path.join(artifacts, "permission-plan.sql");
    if (fs.existsSync(target)) fs.unlinkSync(target);
    await page.click("#download");
    for (let i = 0; i < 40 && !fs.existsSync(target); i++)
      await new Promise((r) => setTimeout(r, 100));
    check(fs.readFileSync(target, "utf8"), initial);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "desktop.png"),
      fullPage: true,
    });
    await operation("grants");
    check(
      await page.$eval("#grant-mode-object", (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    );
    await onlyType("column");
    check(
      await page.$eval("#permissions", (e) =>
        e.textContent.includes("REFERENCES"),
      ),
    );
    await add();
    check(await page.$eval("#plan-count", (e) => e.textContent), "2");
    await onlyType("procedure");
    // After an empty type set, the first permission starts checked again.
    check(
      await page.$eval('[name=privilege][value="EXECUTE"]', (e) => e.checked),
    );
    await add();
    check(
      (await sql()).includes(
        'ON PROCEDURE "example_schema"."example_routine"(integer, text)',
      ),
    );
    await onlyType("parameter");
    check(await page.$eval('[name=privilege][value="SET"]', (e) => e.checked));
    await add();
    check(await page.$eval("#plan-count", (e) => e.textContent), "4");
    await page.select("#version", "14");
    check(await page.$eval("#download", (b) => b.disabled));
    check(await page.$eval("#plan-error", (e) => !e.hidden));
    await page.select("#version", "17");
    check(await page.$eval("#download", (b) => !b.disabled));
    await page.click("#grant-mode-default");
    await onlyType("schema");
    check(
      await page.$eval('[name=privilege][value="USAGE"]', (e) => e.checked),
    );
    check(await page.$eval("#schemas", (e) => e.value), "");
    check(await page.$eval("#creators", (e) => e.value), "");
    await add();
    check(
      (await sql()).includes(
        "ALTER DEFAULT PRIVILEGES\n  GRANT USAGE ON SCHEMAS TO",
      ),
    );
    await operation("membership");
    await page.click("#builtin-panel summary");
    await page.click('[name=builtin][value="pg_monitor"]');
    check(await page.$eval("#roles", (e) => e.value), "");
    check(await page.$eval("#roles", (e) => e.placeholder), "example_writer");
    await add();
    check(await page.$eval("#plan-count", (e) => e.textContent), "6");
    await page.select("#platform", "aurora");
    check(await page.$eval("#operation", (e) => e.value), "membership");
    await page.click("#builtin-panel summary");
    check(
      await page.$eval(
        '[name=builtin][value="pg_execute_server_program"]',
        (e) => e.disabled,
      ),
    );
    await page.click('[name=builtin][value="pg_monitor"]');
    await page.select("#action", "revoke");
    await page.select("#revokeOption", "SET");
    await add();
    check((await sql()).includes("REVOKE SET OPTION FOR"));
    await operation("grants");
    await page.click("#grant-mode-object");
    await page.$eval("#targets", (e) => (e.value = ""));
    await add();
    check(await page.$eval("#form-error", (e) => !e.hidden));
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clear");
    check(await page.$eval("#plan-count", (e) => e.textContent), "0");
    // Create role WITH LOGIN. Compare passwords only as booleans so a
    // failure never prints a generated value.
    const pw = () => page.$eval("#password", (e) => e.value);
    const allowed = /^[A-Za-z0-9!@#$%^&*_-]{16}$/;
    await operation("group");
    check(await page.$eval("#login", (e) => e.checked), false);
    check(await page.$("#password"), null);
    check(await page.$$eval("input[type=password]", (els) => els.length), 0);
    await page.click("#login");
    const first = await pw();
    check(allowed.test(first));
    check(await page.$eval("#password", (e) => e.type), "text");
    check(await page.$eval("#password", (e) => e.labels[0].textContent), "Password");
    await page.click("#regenerate-password");
    const second = await pw();
    check(allowed.test(second));
    check(second !== first);
    // Unchecking removes the input; checking again starts fresh.
    await page.click("#login");
    check(await page.$("#password"), null);
    await page.click("#login");
    check(allowed.test(await pw()));
    check((await pw()) !== second);
    await page.$eval("#group", (e) => (e.value = "example_login"));
    await page.$eval("#password", (e) => (e.value = "test-pass'word"));
    await add();
    let loginSql = await sql();
    check(loginSql.includes(`CREATE ROLE "example_login" LOGIN PASSWORD E'test-pass''word' NOSUPERUSER`));
    check(loginSql.includes("-- WARNING: This script contains a login password."));
    check(
      await page.$eval("#plan-list summary", (e) => e.textContent.includes("Create login · example_login")),
    );
    check(
      await page.$eval("#plan-list", (e) => e.textContent.includes("password set") && !e.textContent.includes("test-pass")),
    );
    check(await page.$eval("#verify-code", (e) => e.textContent.includes("test-pass")), false);
    // Empty password is rejected in the form.
    await page.$eval("#password", (e) => (e.value = ""));
    await add();
    check(await page.$eval("#form-error", (e) => /password/i.test(e.textContent)));
    // Unchecked: NOLOGIN group, no PASSWORD clause for the new operation.
    await page.click("#login");
    await page.$eval("#group", (e) => (e.value = "example_nologin"));
    await add();
    loginSql = await sql();
    check(loginSql.includes('CREATE ROLE "example_nologin" NOLOGIN NOSUPERUSER'));
    check(loginSql.match(/PASSWORD E'/g).length, 1);
    check(
      await page.$$eval("#plan-list summary", (els) => els.map((e) => e.textContent.slice(2)).join("|")),
      "Create login · example_login|Create group · example_nologin",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clear");
    check((await sql()).includes("PASSWORD"), false);
    check(
      await page.evaluate(() => localStorage.length + sessionStorage.length + document.cookie.length),
      0,
    );
    await operation("grants");
    // Keyboard: the toggle bar is a pair of buttons.
    await page.focus("#grant-mode-default");
    await page.keyboard.press("Enter");
    check(
      await page.$eval("#grant-mode-default", (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    );
    await page.focus("#operation");
    await page.keyboard.press("ArrowUp");
    check(await page.$eval("#operation", (e) => e.value), "profile");
    check(await page.$("#group").then(Boolean));
    await add();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, "mobile-top.png") });
    await page.screenshot({
      path: path.join(artifacts, "mobile.png"),
      fullPage: true,
    });
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll("input,select,textarea")]
        .filter((el) => !el.labels?.length && !el.getAttribute("aria-label"))
        .map((el) => el.id),
    );
    check(unlabeled.length, 0);
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      { timeout: 10000 },
    );
    check(
      await page.evaluate(async () =>
        (await caches.keys()).includes("pg-role-grantor-v9"),
      ),
    );
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "networkidle0" });
    check(
      await page.$eval("h1", (e) => e.textContent),
      "Build a permission script",
    );
    // Reload clears the plan and form; nothing is persisted.
    check(await page.$eval("#plan-count", (e) => e.textContent), "0");
    check(await page.$eval("#operation", (e) => e.value), "profile");
    await add();
    check((await sql()).includes("CREATE ROLE"));
    await operation("group");
    check(await page.$eval("#login", (e) => e.checked), false);
    check(await page.$("#password"), null);
    check(external.length, 0);
    check(errors.length, 0);
    console.log(
      `PASS: ${checks} browser checks. Chromium ${await browser.version()}. Desktop 1440×1100, mobile 390×844, copy, download, offline, validation, version switch, operation dropdown, toggle bar, placeholders, WITH LOGIN password field, and zero external requests.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
