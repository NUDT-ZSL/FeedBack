let file = null, session = null, paused = false, uploading = false;
let pollTimer = null;

const $ = id => document.getElementById(id);

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function tokenFor(f) {
  const key = "upload-token-" + f.name + "-" + f.size;
  let t = localStorage.getItem(key);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(key, t); }
  return t;
}

async function initSession() {
  const res = await fetch("/api/uploads", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name, size: file.size,
      chunk_size: +$("chunkSize").value, client_token: tokenFor(file),
    }),
  });
  if (!res.ok) throw new Error("初始化失败: " + res.status);
  session = await res.json();
}

async function refresh() {
  if (!session) return;
  const res = await fetch("/api/uploads/" + session.id);
  if (res.ok) { session = await res.json(); render(); }
}

async function uploadChunk(i) {
  const cs = session.chunk_size;
  const blob = file.slice(i * cs, Math.min((i + 1) * cs, file.size));
  const buf = await blob.arrayBuffer();
  let sha = await sha256Hex(buf);
  if (+$("corruptAt").value === i) sha = "0".repeat(64); // 演示：校验失败
  const res = await fetch(`/api/uploads/${session.id}/chunks/${i}`, {
    method: "PUT", headers: { "x-chunk-sha256": sha }, body: buf,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`分段 ${i} 失败 (${res.status}): ${t}`);
  }
  return res.json();
}

async function uploadLoop() {
  if (uploading) return;
  uploading = true; paused = false;
  $("btnPause").disabled = false; $("btnResume").disabled = true;
  try {
    await refresh();
    for (const i of [...session.missing_chunks]) {
      if (paused) break;
      markCell(i, "sending");
      try {
        await uploadChunk(i);
      } catch (e) {
        console.warn(e.message);
      }
      await refresh();
    }
  } finally {
    uploading = false;
    $("btnPause").disabled = true;
    await refresh();
    if (session.state === "uploaded") startConvert();
  }
}

async function retryChunk(i) {
  markCell(i, "sending");
  try { await uploadChunk(i); } catch (e) { console.warn(e.message); }
  await refresh();
  if (session.state === "uploaded") startConvert();
}

async function startConvert() {
  const failAt = +$("failAt").value;
  const url = "/api/uploads/" + session.id + "/convert" +
    (failAt >= 0 ? "?fail_at=" + failAt : "");
  await fetch(url, { method: "POST" });
  await refresh();
}

function markCell(i, cls) {
  const c = $("grid").children[i];
  if (c) c.className = "cell " + cls;
}

function render() {
  const s = session;
  const got = s.received_chunks.length;
  $("upBar").style.width = (100 * got / s.total_chunks) + "%";
  $("upStat").textContent =
    `状态 ${s.state} · 已接收 ${got}/${s.total_chunks} 段 · 计费字节 ${s.bytes_billed}`;
  const grid = $("grid");
  if (grid.children.length !== s.total_chunks) {
    grid.innerHTML = "";
    for (let i = 0; i < s.total_chunks; i++) {
      const d = document.createElement("div");
      d.className = "cell"; d.textContent = i; d.title = "分段 " + i;
      grid.appendChild(d);
    }
  }
  const okSet = new Set(s.received_chunks);
  const failMap = s.failed_chunks || {};
  for (let i = 0; i < s.total_chunks; i++) {
    const c = grid.children[i];
    c.className = "cell " + (failMap[i] ? "fail" : okSet.has(i) ? "ok" : "");
    c.title = "分段 " + i + (failMap[i] ? " 失败: " + failMap[i].error : "");
  }
  $("fails").innerHTML = "";
  for (const [idx, info] of Object.entries(failMap)) {
    const div = document.createElement("div");
    div.className = "failitem";
    div.textContent = `分段 ${idx} 失败：${info.error} `;
    const b = document.createElement("button");
    b.textContent = "重试该分段";
    b.onclick = () => retryChunk(+idx);
    div.appendChild(b);
    $("fails").appendChild(div);
  }
  const cv = s.conversion;
  $("convBar").style.width = (100 * cv.progress) + "%";
  $("convStat").textContent =
    `状态 ${s.state} · 已转换 ${cv.converted_count}/${s.total_chunks} 段` +
    (cv.error ? ` · 失败于第 ${cv.failed_at} 段：${cv.error}` : "");
  $("btnConvert").disabled = !(s.state === "uploaded");
  $("btnResumeConv").disabled = !(s.state === "convert_failed" && !cv.running);
  $("result").innerHTML = s.result_ready
    ? `结果文件已生成：<a href="/api/uploads/${s.id}/result">下载 result.ufmt</a>`
    : "尚未生成结果文件";
}

async function pollEvents() {
  if (!session) return;
  const res = await fetch("/api/uploads/" + session.id + "/events");
  if (!res.ok) return;
  const { events } = await res.json();
  $("events").innerHTML = events.map(e =>
    `<tr><td>${e.ts}</td><td>${e.type}</td><td>${e.message}</td></tr>`).join("");
}

$("btnStart").onclick = async () => {
  file = $("file").files[0];
  if (!file) { alert("请先选择文件"); return; }
  $("btnStart").disabled = true;
  await initSession();
  render();
  pollTimer = setInterval(async () => { await refresh(); await pollEvents(); }, 1000);
  uploadLoop();
};
$("btnPause").onclick = () => {
  paused = true;
  $("btnResume").disabled = false;
};
$("btnResume").onclick = () => uploadLoop();
$("btnConvert").onclick = () => startConvert();
$("btnResumeConv").onclick = () => startConvert();
