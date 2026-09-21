const { spawn, execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const WebSocket = require("ws");

const port = 9323;
const chromePath = process.env.CHROME_PATH || join(
  process.env.LOCALAPPDATA || "",
  "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"
);
const profile = mkdtempSync(join(tmpdir(), "score-workbench-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${port}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-gpu",
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getDebugTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page && page.webSocketDebuggerUrl) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error("无法连接 Chrome DevTools 端口");
}

function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error(method + " 超时")), 10000);
    ws.on("message", function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.id === id) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await cdp(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "页面脚本异常");
  }
  return result.result.value;
}

async function main() {
  const target = await getDebugTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Page.navigate", { url: "http://localhost:4173/" });
  await sleep(500);

  const interaction = `(async () => {
    const text = () => document.body.innerText;
    const initial = text();
    const score = document.querySelector('[data-focus="score-d-safety"]');
    score.focus();
    score.value = "50";
    score.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    const afterScore = text();
    const weight = document.querySelector('[data-focus="score-weight-d-safety"]');
    weight.focus();
    await new Promise(r => setTimeout(r, 100));
    weight.value = "80";
    weight.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    return { initial, afterScore, afterWeight: text() };
  })()`;
  const pages = await evaluate(ws, interaction);
  const schemeInteraction = `(async () => {
    document.querySelector('[data-tab="scheme"]').click();
    await new Promise(r => setTimeout(r, 50));
    const safeWeight = document.querySelector('[data-focus="weight-d-safety"]');
    safeWeight.focus();
    await new Promise(r => setTimeout(r, 50));
    safeWeight.value = "90";
    safeWeight.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    return document.body.innerText;
  })()`;
  pages.scheme = await evaluate(ws, schemeInteraction);
  ws.close();

  const required = [
    [pages.initial, "技能训练营评分工作台"],
    [pages.initial, "林一诺"],
    [pages.initial, "缺分：按满分处理"],
    [pages.afterScore, "80.5 分 · 熟练"],
    [pages.afterWeight, "权重调整触发等级变化"],
    [pages.afterWeight, "熟练（80.5 分）→ 需复训"],
    [pages.afterWeight, "调整前"],
    [pages.afterWeight, "调整后"],
    [pages.scheme, "权重调整触发等级变化"],
    [pages.scheme, "添加总评等级"]
  ];
  const failures = required.filter(([content, expected]) => !content.includes(expected));
  if (failures.length) {
    failures.forEach(([, expected]) => console.error("缺少：" + expected));
    console.error(pages.afterWeight.slice(0, 1500));
    process.exitCode = 1;
  } else {
    console.log("浏览器冒烟测试通过：默认工作台、缺省策略、实时重算和跨级前后依据均正常。");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try {
    execFileSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000);
});
