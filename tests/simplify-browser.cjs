const puppeteer = require("puppeteer-core");
const assert = require("node:assert/strict");
// Checks the simplified layout with real clicks and typing: common fields up
// front, rarely used ones in collapsed Advanced options, hints behind "?".
(async () => {
  const url = process.env.SITE_URL || "http://127.0.0.1:8086/";
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  let checks = 0;
  const check = (a, b = true) => {
    assert.deepEqual(a, b);
    checks++;
  };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "networkidle0" });
    const visible = (sel) =>
      page.$eval(sel, (e) => e.checkVisibility()).catch(() => false);
    const sql = () => page.$eval("#sql-code", (e) => e.textContent);
    const count = (id) =>
      page.$eval(`#${id} > summary .adv-count`, (e) => e.textContent);
    const open = (id) => page.$eval(`#${id}`, (e) => e.open);
    const add = () => page.click("button[type=submit]");
    // Operation comes first, then the target engine and version.
    check(
      await page.$$eval(".engine-line select", (els) => els.map((e) => e.id)),
      ["operation", "platform", "version"],
    );
    // Access setup: creators is out of sight until Advanced is opened.
    check(await open("profile-advanced"), false);
    check(await visible("#creators"), false);
    check(await visible("#members"), true);
    check(await count("profile-advanced"), "");
    await page.click("#profile-advanced > summary");
    check(await visible("#creators"), true);
    await page.type("#creators", "example_owner");
    check(await count("profile-advanced"), "(1 set)");
    await add();
    check((await sql()).includes('FOR ROLE "example_owner"'));
    // Hints stay hidden until the "?" button next to the label is used.
    check(await visible("#schemas-hint"), false);
    check(
      await page.$eval("#schemas", (e) => e.getAttribute("aria-describedby")),
      "schemas-hint",
    );
    await page.click('button.help[aria-controls="schemas-hint"]');
    check(await visible("#schemas-hint"), true);
    check(
      await page.$eval('button.help[aria-controls="schemas-hint"]', (e) =>
        e.getAttribute("aria-expanded"),
      ),
      "true",
    );
    await page.click('button.help[aria-controls="schemas-hint"]');
    check(await visible("#schemas-hint"), false);
    // Grants, Future objects: creators and schema scope live in Advanced.
    await page.select("#operation", "grants");
    check(await open("grant-advanced"), false);
    check(await visible("#grantees"), true);
    check(await visible("#public"), true);
    check(await visible("#grantOption"), false);
    await page.click("#grant-mode-default");
    check(await visible("#creators"), false);
    check(await visible("#schemas"), false);
    check(
      await page.$eval("#grant-advanced", (e) => !!e.querySelector("#creators")),
    );
    await page.click("#grant-advanced > summary");
    await page.type("#schemas", "example_schema");
    await page.click("#grantOption");
    check(await count("grant-advanced"), "(2 set)");
    await page.click("#grant-mode-object");
    check(
      await page.$eval("#grant-advanced", (e) => !!e.querySelector("#creators")),
      false,
    );
    check(await visible("#grantOption"), false);
    // Membership: predefined roles and member options are both collapsed.
    await page.select("#operation", "membership");
    check(await open("builtin-panel"), false);
    check(await open("member-advanced"), false);
    check(await visible("#action"), true);
    check(await visible("#admin"), false);
    await page.click("#member-advanced > summary");
    await page.click("#admin");
    check(await count("member-advanced"), "(1 set)");
    await page.select("#action", "revoke");
    check(await visible("#revokeOption"), true);
    // FDW: three numbered steps; TLS sits under Advanced options.
    await page.select("#operation", "fdw");
    check(
      await page.$$eval(".step-heading", (els) => els.map((e) => e.textContent)),
      ["1Remote server", "2Role mappings", "3Tables & permissions"],
    );
    check(await open("tls-options"), false);
    check(await visible("#sslmode"), false);
    await page.click("#tls-options > summary");
    await page.select("#sslmode", "require");
    check(await count("tls-options"), "(1 set)");
    // Removing a mapping or column still works with the "?" buttons in the rows.
    check(await page.$$eval(".mapping-row", (e) => e.length), 2);
    await page.click(".mapping-row .remove-row");
    check(await page.$$eval(".mapping-row", (e) => e.length), 1);
    // Reset form keeps its screen-reader note without showing it.
    check(
      await page.$eval("#reset-help", (e) => e.classList.contains("sr-only")),
    );
    check(errors, []);
    console.log(
      `PASS: ${checks} simplified-layout browser checks. Operation first, Advanced options collapsed with set-counts, hints behind ?, FDW steps, and no console errors.`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
