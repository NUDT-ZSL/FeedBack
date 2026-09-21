const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(ws, id, method, params = {}) {
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    ws.addEventListener("message", function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message || message.error.data));
      else resolve(message.result);
    });
  });
}

async function evaluate(ws, id, expression) {
  const result = await rpc(ws, id, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const port = process.env.SMOKE_DEBUG_PORT || "9224";
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((item) => item.type === "page" && item.url.endsWith("/index.html"));
if (!page) throw new Error("The offline search page was not found in Chrome targets");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

await evaluate(ws, 1, `(async () => {
  const $ = (id) => document.getElementById(id);
  $("queryInput").value = "";
  $("searchForm").requestSubmit();
  await new Promise((done) => setTimeout(done, 350));
  $("queryInput").value = "数据";
  $("searchForm").requestSubmit();
  await new Promise((done) => setTimeout(done, 2600));
})()`);

const staleState = await evaluate(ws, 2, `(() => ({
  notices: document.getElementById("notices").textContent,
  current: document.getElementById("currentTitle").textContent,
  contexts: document.querySelectorAll(".context-card").length
}))()`);

if (!staleState.notices.includes("有批次在上下文过期后到达")) {
  throw new Error("Expected a recoverable stale-batch notice");
}
if (staleState.contexts !== 2) throw new Error("Expected two retained browsing contexts");

await evaluate(ws, 3, `document.querySelector(".context-card:not(.active)").click()`);
await sleep(300);
const reused = await evaluate(ws, 4, `(() => ({
  current: document.getElementById("currentTitle").textContent,
  resultCount: document.querySelectorAll(".result-card").length,
  batchCount: document.querySelectorAll(".batch-row").length
}))()`);

if (!reused.current.includes("空关键词")) throw new Error("Did not switch back to the original context");
if (reused.resultCount !== 4) throw new Error("Original context did not reuse its arrived batches");
if (reused.batchCount !== 4) throw new Error("Batch inspector did not retain the original batches");

await evaluate(ws, 5, `(async () => {
  document.getElementById("conflictToggle").click();
  document.getElementById("retriggerBtn").click();
  await new Promise((done) => setTimeout(done, 3100));
})()`);

const conflict = await evaluate(ws, 6, `(() => ({
  hasConflict: Boolean(document.querySelector(".result-card.conflict")),
  claimCount: document.querySelectorAll(".result-card.conflict .claim").length,
  text: document.getElementById("results").textContent
}))()`);

if (!conflict.hasConflict || conflict.claimCount !== 2) {
  throw new Error("Conflicting same-position batches were not both retained");
}

await evaluate(ws, 7, `[...document.querySelectorAll(".result-card.conflict button")]
  .find((button) => button.textContent.includes("裁决采用此内容")).click()`);
await sleep(200);
const resolved = await evaluate(ws, 8, `Boolean(document.querySelector(".result-card.resolved .claim.chosen"))`);
if (!resolved) throw new Error("Conflict resolution did not update the current view");

console.log(JSON.stringify({ staleState, reused, conflict: { claimCount: conflict.claimCount }, resolved }, null, 2));
ws.close();
