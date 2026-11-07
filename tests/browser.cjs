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
    check(await page.title(), "PG role grantor · Permission scripts");
    check(await page.$eval("#download", (b) => b.disabled));
    await page.click("button[type=submit]");
    await page.waitForFunction(
      () => document.querySelector("#plan-count").textContent === "1",
    );
    const initial = await page.$eval("#sql-code", (e) => e.textContent);
    check(initial.includes('CREATE ROLE "example_writer" NOLOGIN'));
    check(initial.includes("WITH ADMIN FALSE, INHERIT TRUE, SET FALSE"));
    check(initial.includes("GRANT USAGE ON ALL SEQUENCES"));
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
    await page.click("#download");
    for (
      let i = 0;
      i < 40 && !fs.existsSync(path.join(artifacts, "permission-plan.sql"));
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    check(
      fs.readFileSync(path.join(artifacts, "permission-plan.sql"), "utf8"),
      initial,
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "desktop.png"),
      fullPage: true,
    });
    await page.click("#tab-object");
    await page.select("#object", "column");
    check(
      await page.$eval("#permissions", (e) =>
        e.textContent.includes("REFERENCES"),
      ),
    );
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "2");
    await page.select("#object", "procedure");
    await page.click("button[type=submit]");
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        'ON PROCEDURE "example_schema"."example_routine"(integer, text)',
      ),
    );
    await page.select("#object", "parameter");
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "4");
    await page.select("#version", "14");
    check(await page.$eval("#download", (b) => b.disabled));
    check(await page.$eval("#plan-error", (e) => !e.hidden));
    await page.select("#version", "17");
    check(await page.$eval("#download", (b) => !b.disabled));
    await page.click("#tab-default");
    await page.select("#object", "schema");
    check(await page.$eval("#schemas", (e) => e.value), "");
    await page.click("button[type=submit]");
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        "ON SCHEMAS TO",
      ),
    );
    await page.click("#tab-membership");
    await page.select("#builtin", "pg_monitor");
    check(await page.$eval("#roles", (e) => e.value), "pg_monitor");
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "6");
    await page.select("#platform", "aurora");
    await page.click("#tab-membership");
    check(
      await page.$eval(
        'option[value="pg_execute_server_program"]',
        (e) => e.disabled,
      ),
    );
    await page.select("#action", "revoke");
    await page.select("#revokeOption", "SET");
    await page.click("button[type=submit]");
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        "REVOKE SET OPTION FOR",
      ),
    );
    await page.click("#tab-object");
    await page.$eval("#targets", (e) => (e.value = ""));
    await page.click("button[type=submit]");
    check(await page.$eval("#form-error", (e) => !e.hidden));
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clear");
    check(await page.$eval("#plan-count", (e) => e.textContent), "0");
    // Validate keyboard tabs and mobile horizontal overflow.
    await page.focus("#tab-profile");
    await page.keyboard.press("ArrowRight");
    check(
      await page.$eval("#tab-object", (e) => e.getAttribute("aria-selected")),
      "true",
    );
    await page.click("#tab-profile");
    await page.click("button[type=submit]");
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
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "networkidle0" });
    check(
      await page.$eval("h1", (e) =>
        e.textContent.includes("Precise permissions."),
      ),
    );
    await page.click("button[type=submit]");
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        "CREATE ROLE",
      ),
    );
    check(external.length, 0);
    check(errors.length, 0);
    console.log(
      `PASS: ${checks} browser checks. Chromium ${await browser.version()}. Desktop 1440×1100, mobile 390×844, copy, download, offline, validation, version switch, tabs, and zero external requests.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
