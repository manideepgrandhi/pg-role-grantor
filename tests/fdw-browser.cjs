const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const artifacts =
    process.env.ARTIFACTS || "/workspace/pg-role-grantor-artifacts";
  const downloads = path.join(artifacts, "fdw-downloads");
  fs.mkdirSync(downloads, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let count = 0;
  const check = (a, b = true) => {
    assert.equal(a, b);
    count++;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(new URL(url).origin))
        external.push(r.url());
    });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.click("#tab-fdw");
    check(await page.$$eval("input[type=password]", (els) => els.length), 0);
    check(await page.$eval("#sslmode", (e) => e.value), "verify-full");
    check(await page.$$eval(".mapping-row", (els) => els.length), 2);
    check(await page.$eval("#importAs", (e) => e.value), "example_importer");
    await page.click("#add-mapping");
    check(await page.$$eval(".mapping-row", (els) => els.length), 3);
    await page.$eval("#mapping-3-local", (e) => (e.value = "example_app"));
    await page.click("button[type=submit]");
    check(
      await page.$eval("#form-error", (e) =>
        e.textContent.includes("only one user mapping"),
      ),
    );
    await page.$eval("#mapping-3-local", (e) => (e.value = "example_reporter"));
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "1");
    let text = await page.$eval("#sql-code", (e) => e.textContent);
    check(text.includes("__REPLACE_FDW_1_MAPPING_3_PASSWORD_HEX__"));
    check(text.includes("CREATE USER MAPPING FOR %I SERVER %I"));
    check(text.includes('LIMIT TO ("example_items")'));
    check(
      text.includes(
        'GRANT CREATE ON SCHEMA "example_foreign" TO "example_importer"',
      ),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "fdw-desktop.png"),
      fullPage: true,
    });
    await page.$eval("#mapping-rows", (e) =>
      e.scrollIntoView({ block: "center" }),
    );
    await page.screenshot({
      path: path.join(artifacts, "fdw-role-mapping-desktop.png"),
    });
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
    });
    // Avoid stale download bytes across reruns.
    const target = path.join(downloads, "permission-plan.sql");
    if (fs.existsSync(target)) fs.unlinkSync(target);
    await page.click("#download");
    for (let i = 0; i < 40 && !fs.existsSync(target); i++)
      await new Promise((r) => setTimeout(r, 100));
    check(fs.readFileSync(target, "utf8"), text);
    await page.select("#mode", "manual");
    check(await page.$$eval(".column-row", (els) => els.length), 2);
    await page.click("#add-column");
    check(await page.$$eval(".column-row", (els) => els.length), 3);
    await page.$eval(".column-row:last-child .remove-row", (e) => e.click());
    check(await page.$$eval(".column-row", (els) => els.length), 2);
    await page.$eval("#server", (e) => (e.value = "example_manual"));
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "2");
    text = await page.$eval("#sql-code", (e) => e.textContent);
    check(
      text.includes('CREATE FOREIGN TABLE "example_foreign"."example_items"'),
    );
    await page.select("#mode", "server");
    check(await page.$("#localSchema"), null);
    await page.$eval("#server", (e) => (e.value = "example_server_only"));
    await page.click("button[type=submit]");
    check(await page.$eval("#plan-count", (e) => e.textContent), "3");
    await page.click("#clear");
    await page.click("#tab-profile");
    await page.click("#tab-fdw");
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: path.join(artifacts, "fdw-mobile-top.png") });
    await page.screenshot({
      path: path.join(artifacts, "fdw-mobile.png"),
      fullPage: true,
    });
    await page.$eval("#mapping-rows", (e) =>
      e.scrollIntoView({ block: "center" }),
    );
    await page.screenshot({
      path: path.join(artifacts, "fdw-role-mapping-mobile.png"),
    });
    check(
      await page.$$eval(
        "#operation-panel input,#operation-panel select",
        (els) => els.filter((e) => !e.labels?.length).length,
      ),
      0,
    );
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
    );
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "networkidle0" });
    await page.click("#tab-fdw");
    await page.click("button[type=submit]");
    check(
      (await page.$eval("#sql-code", (e) => e.textContent)).includes(
        "CREATE USER MAPPING FOR %I",
      ),
    );
    check(external.length, 0);
    check(errors.length, 0);
    console.log(
      `PASS: ${count} FDW browser checks. Chrome ${await browser.version()}, desktop 1440×1100, mobile 390×844, mapping/column rows, modes, duplicate validation, actual downloaded SQL, offline generation, and no external requests.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
