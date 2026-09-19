const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "autodemo-browser-"));
  const browser = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => localStorage.removeItem("production-chain-workbench-v1"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico"))
      errors.push(message.text());
  });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.waitForSelector("#runStatus");
  if (!(await page.textContent("#runStatus")).includes("推演可满足")) throw new Error("首屏未自动推演");

  await page.click('[data-recipe-enabled="4"]');
  await page.waitForFunction(() => /推演停止|无法|断供/.test(document.querySelector("#runStatus").textContent),
    { timeout: 5000 });
  const shortage = await page.textContent("#shortageBanner");
  if (!shortage.includes("shaft")) throw new Error("停用配方后未标出 shaft 断供");
  await page.click('[data-recipe-enabled="4"]');
  await page.waitForFunction(() => document.querySelector("#runStatus").textContent.includes("推演可满足"),
    { timeout: 5000 });
  await page.screenshot({ path: "browser-smoke.png", fullPage: false });

  await page.fill("#resourceForm input[name=id]", "bad-resource");
  await page.fill("#resourceForm input[name=initialStock]", "abc");
  await page.click("#resourceForm button");
  await page.waitForTimeout(500);
  await page.waitForFunction(() => document.querySelector("#validationErrors:not([hidden])")?.textContent.length > 0);
  if (errors.length) throw new Error(errors.join("\n"));
  await browser.close();
  await fs.rm(profile, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
