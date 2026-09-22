// 小队战术 AI 规划系统前端
const CELL = 52;
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
let S = null;            // 最新状态
let selected = null;     // 选中的角色 uid

async function api(path, body) {
  const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" },
                       body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  return await r.json();
}

async function refresh() {
  S = await api("/api/state");
  if (selected && !S.units.find(u => u.uid === selected && u.alive)) selected = null;
  if (!selected) {
    const p = S.units.find(u => u.side === "player" && u.alive);
    if (p) selected = p.uid;
  }
  render();
}

// ---------- 地图绘制 ----------
const TILE_COLOR = { 0: "#232c3d", 1: "#0c0f16", 2: "#3a3f2a", 3: "#4a4f30" };

function drawMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < S.height; y++)
    for (let x = 0; x < S.width; x++) {
      const t = S.grid[y][x];
      ctx.fillStyle = TILE_COLOR[t];
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      if (t === 2 || t === 3) {
        ctx.fillStyle = "#c9c27a";
        ctx.font = "11px sans-serif";
        ctx.fillText(t === 2 ? "半掩体" : "全掩体", x * CELL + 6, y * CELL + CELL - 6);
      }
    }
  if (S.objective) {
    const [ox, oy] = S.objective;
    ctx.strokeStyle = "#ffd75e";
    ctx.lineWidth = 3;
    ctx.strokeRect(ox * CELL + 4, oy * CELL + 4, CELL - 8, CELL - 8);
    ctx.fillStyle = "#ffd75e";
    ctx.font = "12px sans-serif";
    ctx.fillText("目标", ox * CELL + 12, oy * CELL + 18);
  }
  // 选中角色的当前计划路径
  if (selected && S.active[selected]) {
    const plan = (S.candidates[selected] || []).find(p => p.pid === S.active[selected]);
    if (plan) drawPlanPath(plan);
  }
  for (const u of S.units) {
    if (!u.alive) continue;
    const cx = u.x * CELL + CELL / 2, cy = u.y * CELL + CELL / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fillStyle = u.side === "player" ? "#3b8bd4" : "#c94f4f";
    if (u.uid === selected) { ctx.lineWidth = 3; ctx.strokeStyle = "#6ec6e8"; }
    ctx.fill();
    if (u.uid === selected) ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(u.name, cx, cy - 22);
    ctx.fillText(u.uid, cx, cy + 4);
    // 血条
    ctx.fillStyle = "#333";
    ctx.fillRect(cx - 18, cy + 18, 36, 5);
    ctx.fillStyle = u.hp / u.max_hp > 0.35 ? "#6fbf73" : "#e06c6c";
    ctx.fillRect(cx - 18, cy + 18, 36 * u.hp / u.max_hp, 5);
    if (u.overwatch) {
      ctx.fillStyle = "#f0c060";
      ctx.fillText("警戒", cx, cy + 40);
    }
  }
  ctx.textAlign = "left";
}

function drawPlanPath(plan) {
  ctx.strokeStyle = "#7fd08a";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  const unit = S.units.find(u => u.uid === plan.unit_id);
  let from = [unit.x, unit.y];
  for (const a of plan.actions) {
    if (a.kind === "move") {
      for (const [x, y] of a.path) {
        ctx.beginPath();
        ctx.moveTo(from[0] * CELL + CELL / 2, from[1] * CELL + CELL / 2);
        ctx.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        ctx.stroke();
        from = [x, y];
      }
    } else if (a.kind === "attack" || a.kind === "heal") {
      const t = S.units.find(u => u.uid === a.target);
      if (t) {
        ctx.strokeStyle = a.kind === "attack" ? "#ef7a7a" : "#7fd08a";
        ctx.beginPath();
        ctx.moveTo(from[0] * CELL + CELL / 2, from[1] * CELL + CELL / 2);
        ctx.lineTo(t.x * CELL + CELL / 2, t.y * CELL + CELL / 2);
        ctx.stroke();
        ctx.strokeStyle = "#7fd08a";
      }
    }
  }
  ctx.setLineDash([]);
}

// ---------- 角色列表 ----------
function drawUnits() {
  const el = document.getElementById("units");
  el.innerHTML = "";
  for (const u of S.units.filter(u => u.side === "player")) {
    const d = document.createElement("div");
    d.className = "ucard" + (u.uid === selected ? " sel" : "") + (u.alive ? "" : " dead");
    d.innerHTML = `<b>${u.name}</b> (${u.uid})<br>HP ${u.hp}/${u.max_hp} · AP ${u.ap}/${u.max_ap}
      <div class="bar"><i style="width:${100 * u.hp / u.max_hp}%"></i></div>`;
    d.onclick = () => { selected = u.uid; render(); };
    el.appendChild(d);
  }
}

// ---------- 详情面板：当前计划 + 候选计划对比（需求 4/6） ----------
function drawDetail() {
  const el = document.getElementById("detail");
  const u = S.units.find(u => u.uid === selected);
  if (!u) { el.innerHTML = '<p class="hint">请选择一个角色。</p>'; return; }
  const cands = S.candidates[u.uid] || [];
  const activePid = S.active[u.uid];
  const cur = cands.find(p => p.pid === activePid);
  let html = `<h3>${u.name} (${u.uid})</h3>
    <div class="meta">HP ${u.hp}/${u.max_hp} · AP ${u.ap}/${u.max_ap} · 视野 ${u.vision}
    · 位置 (${u.x},${u.y}) ${u.overwatch ? "· 警戒中" : ""}</div>`;
  if (cur) {
    html += `<div class="curplan"><b>当前计划：</b>${cur.summary}<br>
      <span class="meta">评分 ${cur.score} · ${cur.reason}</span><br>
      <button class="mini cancel" onclick="cancelPlan('${u.uid}')">取消计划</button></div>`;
  } else {
    html += `<div class="curplan none">当前无计划（待命）</div>`;
  }
  if (cands.length) {
    html += `<table><tr><th>评分</th><th>动作序列</th><th>选择理由 / 预期</th>
             <th>状态</th><th></th></tr>`;
    for (const p of cands) {
      const cls = p.pid === activePid ? "active-row" : (p.status === "failed" ? "failed-row" : "");
      const exp = [];
      if (p.expected.damage) exp.push(`伤害${p.expected.damage}`);
      if (p.expected.kill) exp.push(`击杀${p.expected.kill}`);
      if (p.expected.heal) exp.push(`治疗${p.expected.heal}`);
      if (p.expected.risk !== undefined) exp.push(`风险${p.expected.risk}`);
      html += `<tr class="${cls}"><td>${p.score}</td><td>${p.summary}</td>
        <td>${p.reason}${p.fail_reason ? `<br><span style="color:#ef7a7a">失败：${p.fail_reason}</span>` : ""}
        <br><span class="meta">${exp.join(" · ")}</span></td>
        <td>${p.pid === activePid ? "执行中" : p.status}</td>
        <td>${p.pid === activePid ? "" : `<button class="mini" onclick="overridePlan('${u.uid}',${p.pid})">采用</button>`}</td></tr>`;
    }
    html += "</table>";
  } else {
    html += '<p class="hint">尚未生成计划，点击"生成计划"。</p>';
  }
  el.innerHTML = html;
}

// ---------- 事件日志 ----------
function drawLog() {
  const el = document.getElementById("log");
  el.innerHTML = S.log.map(e =>
    `<div><span class="turn">[T${e.turn}]</span> <span class="k-${e.kind}">${e.text}</span></div>`
  ).join("");
  el.scrollTop = el.scrollHeight;
}

function render() {
  document.getElementById("turnInfo").textContent =
    S.winner ? (S.winner === "player" ? "任务成功！" : "任务失败") : `第 ${S.turn} 回合`;
  drawMap(); drawUnits(); drawDetail(); drawLog();
}

// ---------- 交互 ----------
async function overridePlan(uid, pid) { S = await api("/api/override", { uid, pid }); render(); }
async function cancelPlan(uid) { S = await api("/api/cancel", { uid }); render(); }

canvas.addEventListener("click", ev => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / CELL);
  const y = Math.floor((ev.clientY - r.top) / CELL);
  const u = S.units.find(u => u.alive && u.x === x && u.y === y);
  if (u && u.side === "player") { selected = u.uid; render(); }
});

document.getElementById("btnPlan").onclick = async () => { S = await api("/api/plan", {}); render(); };
document.getElementById("btnExec").onclick = async () => { S = await api("/api/execute", {}); render(); };
document.getElementById("btnObstacle").onclick = async () => {
  const x = Math.floor(Math.random() * S.width), y = Math.floor(Math.random() * S.height);
  S = await api("/api/event", { type: "obstacle", x, y }); render();
};
document.getElementById("btnEnemyMove").onclick = async () => {
  S = await api("/api/event", { type: "enemy_move" }); render();
};
document.getElementById("btnReset").onclick = async () => { S = await api("/api/reset", {}); selected = null; render(); };

refresh();
setInterval(refresh, 2000);   // 实时刷新角色状态与计划进度

