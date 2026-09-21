const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", err => errors.push(err.stack || err.message));
  await page.goto("file://" + path.join(__dirname, "..", "index.html").replace(/\\/g, "/"));
  await page.waitForSelector(".target-row");
  const summary = await page.locator("#summary").textContent();
  if (!/目标/.test(summary)) throw new Error("页面摘要未初始化");
  await page.locator(".segment.stay").first().click();
  await page.waitForSelector(".evidence-list li");
  await page.locator('.tab[data-tab="points"]').click();
  await page.waitForSelector("#pointsView.active");
  const pointButtons = await page.locator("#pointsView button").count();
  if (pointButtons < 2) throw new Error(`数据点视图按钮数量异常: ${pointButtons}`);
  await page.locator("#pointsView button").nth(1).click();
  await page.waitForSelector("#editPointForm");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("浏览器冒烟测试通过：", summary);
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
