import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = new URL("../.codex/browser-smoke-profile/", import.meta.url);
const target = new URL("../index.html", import.meta.url);
const child = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=9223",
  `--user-data-dir=${decodeURIComponent(profile.pathname.slice(1))}`,
  "--no-sandbox",
  "--disable-gpu",
  "--allow-file-access-from-files",
  target.href,
], { stdio: "ignore" });

function wsSend(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === id) {
        ws.removeEventListener("message", onMessage);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(ws, expression) {
  const result = await wsSend(ws, ++nextId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails));
  }
  return result.result.value;
}

let nextId = 0;
try {
  let version;
  for (let i = 0; i < 40; i += 1) {
    try {
      version = await fetch("http://127.0.0.1:9223/json/version").then((r) => r.json());
      break;
    } catch { await delay(100); }
  }
  if (!version) throw new Error("Chrome DevTools endpoint did not start");
  let page;
  for (let i = 0; i < 40; i += 1) {
    const pages = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
    page = pages.find((item) => item.url.startsWith("file://") && item.type === "page");
    if (page) break;
    await delay(100);
  }
  if (!page) throw new Error("file page target did not appear");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await wsSend(ws, ++nextId, "Runtime.enable");
  await delay(500);
  await wsSend(ws, ++nextId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await wsSend(ws, ++nextId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await evalJs(ws, `
    const email = document.querySelector('[data-control-id="email"]');
    email.value = 'a@example.com';
    email.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await evalJs(ws, `
    const newsletter = document.querySelector('[data-control-id="newsletter"]');
    newsletter.click();
  `);
  await evalJs(ws, `document.querySelector('[data-control-id="continue-account"]').click()`);
  await delay(100);
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, altKey: true, bubbles: true
  }))`);
  const observed = await evalJs(ws, `({
    current: document.querySelector('[aria-current="step"] .step-title')?.textContent,
    deliveryOpen: document.querySelector('[data-control-id="delivery-method"]') !== null,
    completed: document.querySelector('#step-list li:first-child .badge.ok')?.textContent,
    focus: document.activeElement?.id,
    logs: document.querySelectorAll('#focus-log li').length,
  })`);
  if (!observed.current.includes("选择配送")) throw new Error("Alt+Right did not move to delivery");
  if (!observed.completed.includes("已完成")) throw new Error("First step was not marked completed");
  if (observed.focus !== "task-surface") throw new Error("Step navigation did not move focus to task surface");
  if (!observed.logs) throw new Error("Focus history was not recorded");
  console.log("Browser keyboard smoke test passed:", JSON.stringify(observed));
  ws.close();
} finally {
  child.kill();
}
