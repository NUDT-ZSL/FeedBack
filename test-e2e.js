/* 端到端验证：需先启动 server.py，并安装 puppeteer-core。
 * 运行: node test-e2e.js [端口]
 * 验证点对应需求 1-6。 */
const puppeteer = require("puppeteer-core");

const PORT = process.argv[2] || "8791";
const EXE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new",
    args: ["--no-sandbox", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });

  // 需求1：导入并渲染连续正文
  await page.click("#sampleBtn");
  await page.waitForFunction(() => document.querySelectorAll("#reader .s").length > 50);
  const nSent = await page.$$eval("#reader .s", (els) => els.length);
  check("1. 示例文档渲染为连续句子流", nSent > 50, `${nSent} 句`);

  const noOverflow = () => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth &&
    document.body.scrollWidth <= window.innerWidth);
  check("2a. 默认字号无横向溢出", await noOverflow());

  // 滚到中部，等待锚点捕获
  await page.evaluate(() => window.scrollTo(0, 4000));
  await sleep(400);
  const before = await page.evaluate(() => ({
    id: +document.querySelector("#reader .s.anchor").dataset.sid,
    text: document.querySelector("#reader .s.anchor").textContent,
  }));
  check("5a. 锚点标记已落在当前阅读句上", before.id > 20, `第 ${before.id + 1} 句`);

  const setFont = async (px) => {
    await page.evaluate((v) => {
      const s = document.getElementById("fontSize");
      s.value = v; s.dispatchEvent(new Event("input"));
    }, px);
    await sleep(250);
  };

  // 需求2/3：放大字号后重排、无溢出、锚点句不变且位置接近原比例
  await setFont(64);
  check("2b. 64px 特大字号仍无横向溢出", await noOverflow());
  let after = await page.evaluate(() => {
    const el = document.querySelector("#reader .s.anchor");
    const r = el.getBoundingClientRect();
    return { id: +el.dataset.sid, text: el.textContent,
             top: r.top, ratio: r.top / window.innerHeight };
  });
  check("3a. 放大后锚点仍是同一句", after.id === before.id && after.text === before.text);
  check("3b. 锚点句停留在视口内相近位置", after.top > -10 && after.ratio < 0.6,
        `top=${Math.round(after.top)}px ratio=${after.ratio.toFixed(2)}`);

  // 需求4：特大字号下长段落完整在文档流中，可逐行滚到底
  const flow = await page.evaluate(() => {
    const ps = document.querySelectorAll("#reader p");
    let clipped = 0;
    for (const p of ps) {
      const cs = getComputedStyle(p);
      if (cs.overflow === "hidden" || cs.maxHeight !== "none") clipped++;
    }
    return { clipped, scrollH: document.documentElement.scrollHeight,
             vh: window.innerHeight };
  });
  check("4. 段落无裁切，长文可逐行滚动读完",
        flow.clipped === 0 && flow.scrollH > flow.vh * 3,
        `scrollH=${flow.scrollH}`);

  // 需求5：标记可见且与锚点句对齐
  const mark = await page.evaluate(() => {
    const m = document.getElementById("marker");
    const r = document.querySelector("#reader .s.anchor").getBoundingClientRect();
    return { shown: m.style.display !== "none",
             dy: Math.abs(parseFloat(m.style.top) - r.top) };
  });
  check("5b. ▶ 标记可见且与锚点句对齐", mark.shown && mark.dy < 40,
        `偏差 ${Math.round(mark.dy)}px`);

  // 需求6a：连续微调收敛 —— 逐步 64→40→28→24 与直接回 24 结果一致
  for (const v of [40, 28, 24]) await setFont(v);
  const stepwise = await page.evaluate(() =>
    +document.querySelector("#reader .s.anchor").dataset.sid);
  await setFont(64); await setFont(24);
  const direct = await page.evaluate(() =>
    +document.querySelector("#reader .s.anchor").dataset.sid);
  check("6a. 多步微调与一步到位收敛到同一句", stepwise === direct,
        `stepwise=${stepwise} direct=${direct}`);

  // 需求6b/2c：缩窄视窗重排，锚点保持、无溢出
  await page.setViewport({ width: 640, height: 800 });
  await sleep(400);
  const narrow = await page.evaluate(() => ({
    id: +document.querySelector("#reader .s.anchor").dataset.sid,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  check("6b. 视窗缩窄后锚点保持", narrow.id === direct, `id=${narrow.id}`);
  check("2c. 窄视窗无横向溢出", !narrow.overflow);

  // 需求6c：双栏模式重排稳定
  await page.select("#columns", "2");
  await sleep(300);
  const twoCol = await page.evaluate(() => ({
    id: +document.querySelector("#reader .s.anchor").dataset.sid,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  check("6c. 双栏重排锚点保持且无溢出", twoCol.id === direct && !twoCol.overflow);

  await browser.close();
  console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
