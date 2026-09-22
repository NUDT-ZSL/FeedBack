const CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_RETRY = 3;

let file = null, uploadId = null, totalChunks = 0;
let chunkState = [];        // pending | uploading | done | failed
let chunkErr = [];
let uploading = false, paused = false, failedCount = 0;
let clientKey = null, pollTimer = null;

const $ = id => document.getElementById(id);

$("fileInput").addEventListener("change", e => { file = e.target.files[0] || null; });
$("startBtn").addEventListener("click", startUpload);
$("pauseBtn").addEventListener("click", () => { paused = true; setMsg("已暂停，点击“继续”恢复"); });
$("resumeBtn").addEventListener("click", resumeUpload);
$("resumeConvBtn").addEventListener("click", resumeConversion);
$("failAtBtn").addEventListener("click", simulateFail);

async function startUpload() {
  if (!file) { setMsg("请先选择文件"); return; }
  clientKey = [file.name, file.size, file.lastModified].join(":");
  const saved = localStorage.getItem("upload:" + clientKey);
  const res = await fetch("/api/uploads", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({filename: file.name, size: file.size,
      chunk_size: CHUNK_SIZE, client_key: clientKey})
  });
  const st = await res.json();
  uploadId = st.id;
  localStorage.setItem("upload:" + clientKey, uploadId);
  totalChunks = st.total_chunks;
  chunkState = Array(totalChunks).fill("pending");
  chunkErr = Array(totalChunks).fill("");
  st.received.forEach(i => chunkState[i] = "done");
  failedCount = 0;
  buildGrid();
  refreshUploadBar(st);
  $("sessionInfo").textContent =
    `会话 ${uploadId} ｜ ${st.filename} ｜ ${totalChunks} 段` +
    (st.received_count ? `（恢复会话，已接收 ${st.received_count} 段）` : "");
  startPolling();
  if (st.status === "uploading") runQueue();
}

function buildGrid() {
  const g = $("chunkGrid");
  g.innerHTML = "";
  for (let i = 0; i < totalChunks; i++) {
    const c = document.createElement("div");
    c.className = "cell " + (chunkState[i] === "done" ? "done" : "");
    c.id = "cell" + i;
    c.textContent = i;
    c.title = "点击重试";
    c.addEventListener("click", () => { if (chunkState[i] === "failed") retryChunk(i); });
    g.appendChild(c);
  }
}

function setCell(i, cls, tip) {
  const c = $("cell" + i);
  if (!c) return;
  c.className = "cell " + cls;
  c.title = tip || "";
}

async function runQueue() {
  if (uploading) return;
  uploading = true; paused = false;
  $("pauseBtn").disabled = false; $("resumeBtn").disabled = true;
  for (let i = 0; i < totalChunks; i++) {
    if (paused) break;
    if (chunkState[i] !== "pending") continue;
    await uploadChunk(i, MAX_RETRY);
  }
  uploading = false;
  $("pauseBtn").disabled = true;
  if (failedCount > 0) {
    $("resumeBtn").disabled = false;
    setMsg(`有 ${failedCount} 个分段失败，可点击红色分段单独重试，或点击“继续”重试全部`);
  } else if (!paused) {
    setMsg("");
  }
}

async function uploadChunk(i, retries) {
  chunkState[i] = "uploading"; setCell(i, "uploading");
  const blob = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`/api/uploads/${uploadId}/chunks/${i}`,
        {method: "PUT", body: blob});
      if (!res.ok) throw new Error((await res.json()).detail || ("HTTP " + res.status));
      const r = await res.json();
      chunkState[i] = "done";
      setCell(i, "done", r.deduped ? "服务端已存在，去重跳过（未重复写入）" : "已接收");
      refreshUploadBar();
      return;
    } catch (e) {
      if (attempt === retries) {
        chunkState[i] = "failed"; chunkErr[i] = e.message; failedCount++;
        setCell(i, "failed", `分段 ${i} 失败：${e.message}（点击重试）`);
        setMsg(`分段 ${i} 上传失败：${e.message}`);
      } else {
        await sleep(400 * attempt);
      }
    }
  }
}

async function retryChunk(i) {
  if (chunkState[i] !== "failed") return;
  failedCount--;
  await uploadChunk(i, MAX_RETRY);
  if (failedCount <= 0) { failedCount = 0; setMsg(""); }
}

async function resumeUpload() {
  // 网络恢复后：先向服务端确认已接收分段，只补传缺失的
  const res = await fetch(`/api/uploads/${uploadId}`);
  const st = await res.json();
  st.received.forEach(i => {
    if (chunkState[i] !== "done") { chunkState[i] = "done"; setCell(i, "done"); }
  });
  for (let i = 0; i < totalChunks; i++) {
    if (chunkState[i] === "failed") { chunkState[i] = "pending"; setCell(i, ""); }
  }
  failedCount = 0;
  refreshUploadBar(st);
  runQueue();
}

function refreshUploadBar(st) {
  const done = chunkState.filter(s => s === "done").length;
  const pct = totalChunks ? Math.round(done / totalChunks * 100) : 0;
  $("uploadBar").style.width = pct + "%";
  $("uploadPct").textContent = `${done}/${totalChunks} 段（${pct}%）` +
    (st ? `｜服务端实际写入 ${st.bytes_written} 字节` : "");
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStatus, 1000);
  pollStatus();
}

async function pollStatus() {
  if (!uploadId) return;
  try {
    const st = await (await fetch(`/api/uploads/${uploadId}`)).json();
    refreshUploadBar(st);
    const label = {uploading: "上传中", queued: "排队等待转换",
      converting: "转换中", completed: "已完成",
      conversion_failed: "转换失败"}[st.status] || st.status;
    const pct = st.convert_total ? Math.round(st.convert_done / st.convert_total * 100) : 0;
    $("convBar").style.width = pct + "%";
    $("convStatus").textContent =
      `${label} ${st.convert_done}/${st.convert_total}` +
      (st.error ? `｜${st.error}` : "");
    $("resumeConvBtn").disabled = st.status !== "conversion_failed";
    if (st.has_result) {
      const a = $("downloadLink");
      a.style.display = "inline";
      a.href = `/api/uploads/${uploadId}/result`;
      a.textContent = "下载结果文件";
    }
    const ev = await (await fetch(`/api/uploads/${uploadId}/events`)).json();
    renderEvents(ev.events);
    if (st.status === "completed") {
      localStorage.removeItem("upload:" + clientKey);
      clearInterval(pollTimer); pollTimer = null;
    }
  } catch (e) {
    $("convStatus").textContent = "连接中断，正在重试…（已接收分段不会丢失）";
  }
}

async function resumeConversion() {
  const res = await fetch(`/api/uploads/${uploadId}/conversion/resume`, {method: "POST"});
  const r = await res.json();
  if (!res.ok) { setMsg(r.detail || "恢复失败"); return; }
  setMsg(`已从分段 ${r.from_chunk} 恢复转换`);
  startPolling();
}

async function simulateFail() {
  const idx = parseInt($("failIdx").value, 10);
  if (isNaN(idx)) { setMsg("请输入要模拟失败的分段号"); return; }
  await fetch(`/api/uploads/${uploadId}/debug/fail-at`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({idx})
  });
  setMsg(`已设置：转换到分段 ${idx} 时将模拟失败`);
}

function renderEvents(events) {
  const ul = $("eventLog");
  ul.innerHTML = "";
  events.forEach(e => {
    const li = document.createElement("li");
    if (e.type === "error") li.className = "error";
    const t = new Date(e.ts * 1000).toLocaleTimeString();
    li.textContent = `[${t}] [${e.type}] ${e.message}`;
    ul.appendChild(li);
  });
  ul.scrollTop = ul.scrollHeight;
}

function setMsg(m) { $("chunkMsg").textContent = m; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
