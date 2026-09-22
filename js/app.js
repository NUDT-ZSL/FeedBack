// 应用主逻辑：状态、导入解析、围栏配置、推演调度与事件展示。
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const COLORS = ["#2f9ded", "#e0533d", "#2fbf71", "#e0b45c", "#c44fe0", "#3dc2c2"];

  const state = {
    fences: [], points: [], warnings: [],
    events: [], suppressed: [],
    nextFenceId: 1, selectedEvent: null
  };

  const view = MapView.create($("map"), {
    onChange: () => scheduleRun(),
    onSelect: f => { renderFenceList(); renderFenceForm(f); },
    onDraftDone: poly => {
      addFence(poly);
      setMode("edit");
    }
  });

  function addFence(polygon) {
    const f = {
      id: "F" + state.nextFenceId,
      name: "围栏" + state.nextFenceId,
      color: COLORS[(state.nextFenceId - 1) % COLORS.length],
      priority: state.nextFenceId,
      polygon,
      minDwellSec: 10, minGapSec: 5,
      rules: {
        enter: { enabled: true },
        exit: { enabled: true },
        dwell: { enabled: true, seconds: 60 },
        overspeed: { enabled: false, maxKmh: 50 }
      }
    };
    state.nextFenceId++;
    state.fences.push(f);
    view.fences = state.fences;
    view.selectedFenceId = f.id;
    renderFenceList(); renderFenceForm(f); view.render();
    scheduleRun();
    return f;
  }

  function selectedFence() {
    return state.fences.find(f => f.id === view.selectedFenceId) || null;
  }

  // ---------- 围栏列表与配置表单 ----------
  function renderFenceList() {
    const el = $("fence-list");
    el.innerHTML = "";
    if (!state.fences.length) {
      el.innerHTML = '<p class="muted">暂无围栏，点击“绘制围栏”开始</p>';
      return;
    }
    for (const f of state.fences) {
      const div = document.createElement("div");
      div.className = "fence-item" + (f.id === view.selectedFenceId ? " selected" : "");
      div.innerHTML = `<span class="swatch" style="background:${f.color}"></span>
        <span class="grow">${f.name} · P${f.priority}</span>
        <button data-act="del">删除</button>`;
      div.onclick = e => {
        if (e.target.dataset.act === "del") {
          state.fences = state.fences.filter(x => x.id !== f.id);
          view.fences = state.fences;
          if (view.selectedFenceId === f.id) view.selectedFenceId = null;
          renderFenceList(); renderFenceForm(null); view.render(); scheduleRun();
          return;
        }
        view.selectedFenceId = f.id;
        renderFenceList(); renderFenceForm(f); view.render();
      };
      el.appendChild(div);
    }
  }

  function renderFenceForm(f) {
    const el = $("fence-form");
    if (!f) { el.innerHTML = '<p class="muted">在地图上绘制或选中一个围栏</p>'; return; }
    el.innerHTML = `
      <div class="form-grid">
        <label>名称</label><input type="text" id="ff-name" value="${f.name}" style="width:140px">
        <label>优先级</label><input type="number" id="ff-prio" value="${f.priority}" min="1" title="数值小者优先，重叠时独占点位归属">
        <label>最小停留(s)</label><input type="number" id="ff-mindwell" value="${f.minDwellSec}" min="0" title="短于该时长的穿越被过滤">
        <label>最小穿越(s)</label><input type="number" id="ff-mingap" value="${f.minGapSec}" min="0" title="短于该时长的出界视为边界抖动">
      </div>
      <div class="row"><label class="rule-row"><input type="checkbox" id="ff-enter" ${f.rules.enter.enabled ? "checked" : ""}> 进入事件</label>
        <label class="rule-row"><input type="checkbox" id="ff-exit" ${f.rules.exit.enabled ? "checked" : ""}> 离开事件</label></div>
      <div class="row"><label class="rule-row"><input type="checkbox" id="ff-dwell" ${f.rules.dwell.enabled ? "checked" : ""}> 停留超时，阈值(s)</label>
        <input type="number" id="ff-dwellsec" value="${f.rules.dwell.seconds}" min="1"></div>
      <div class="row"><label class="rule-row"><input type="checkbox" id="ff-speed" ${f.rules.overspeed.enabled ? "checked" : ""}> 超速，限速(km/h)</label>
        <input type="number" id="ff-maxkmh" value="${f.rules.overspeed.maxKmh}" min="1"></div>`;
    const bind = (id, fn) => $(id).addEventListener("change", e => { fn(e.target); scheduleRun(); });
    bind("ff-name", t => { f.name = t.value || f.name; renderFenceList(); });
    bind("ff-prio", t => { f.priority = parseInt(t.value) || f.priority; renderFenceList(); });
    bind("ff-mindwell", t => f.minDwellSec = Math.max(0, +t.value || 0));
    bind("ff-mingap", t => f.minGapSec = Math.max(0, +t.value || 0));
    bind("ff-enter", t => f.rules.enter.enabled = t.checked);
    bind("ff-exit", t => f.rules.exit.enabled = t.checked);
    bind("ff-dwell", t => f.rules.dwell.enabled = t.checked);
    bind("ff-dwellsec", t => f.rules.dwell.seconds = Math.max(1, +t.value || 1));
    bind("ff-speed", t => f.rules.overspeed.enabled = t.checked);
    bind("ff-maxkmh", t => f.rules.overspeed.maxKmh = Math.max(1, +t.value || 1));
  }

  // ---------- 轨迹导入与校验 ----------
  // 无效点（缺时间戳、坐标非法）跳过并记录提示，不中断推演。
  // 坐标模式：列名含 lat/lon（或 JSON 字段 lat/lon）按经纬度，否则按 x/y 米。
  function parseTrack(text) {
    const warnings = [];
    let rows = [];
    text = text.trim();
    if (!text) return { points: [], warnings: ["导入内容为空"] };
    if (text[0] === "[") {
      let arr;
      try { arr = JSON.parse(text); }
      catch (e) { return { points: [], warnings: ["JSON 解析失败：" + e.message] }; }
      const latlon = arr.some(o => o && (o.lat != null || o.lon != null || o.lng != null));
      rows = arr.map((o, i) => ({
        line: i + 1, latlon,
        time: o.time ?? o.t ?? o.timestamp,
        a: latlon ? o.lat : o.x,
        b: latlon ? (o.lon ?? o.lng) : o.y,
        speed: o.speed ?? o.v
      }));
    } else {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const first = lines[0].split(/[,\t;]/).map(s => s.trim().toLowerCase());
      const hasHeader = first.some(h => /[a-z一-龥]/.test(h)) && Geo.parseTime(first[0]) == null;
      const idx = name => first.findIndex(h => h.includes(name));
      const latlon = hasHeader && idx("lat") >= 0;
      const ci = {
        time: hasHeader ? Math.max(0, first.findIndex(h => /time|时间|timestamp/.test(h))) : 0,
        a: hasHeader ? (latlon ? idx("lat") : Math.max(1, idx("x"))) : 1,
        b: hasHeader ? (latlon ? Math.max(2, idx("lon") >= 0 ? idx("lon") : idx("lng")) : Math.max(2, idx("y"))) : 2,
        speed: hasHeader ? idx("speed") : 3
      };
      for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
        const c = lines[i].split(/[,\t;]/).map(s => s.trim());
        rows.push({ line: i + 1, latlon, time: c[ci.time],
                    a: c[ci.a], b: c[ci.b], speed: ci.speed >= 0 ? c[ci.speed] : null });
      }
    }
    const points = [];
    let ref = null;
    for (const r of rows) {
      const t = Geo.parseTime(r.time);
      if (t == null) {
        warnings.push(`第 ${r.line} 行：缺失或无法解析时间戳，已跳过`);
        continue;
      }
      const a = parseFloat(r.a), b = parseFloat(r.b);
      if (!isFinite(a) || !isFinite(b)) {
        warnings.push(`第 ${r.line} 行：坐标无效 (${r.a}, ${r.b})，已跳过`);
        continue;
      }
      if (r.latlon && (Math.abs(a) > 90 || Math.abs(b) > 180)) {
        warnings.push(`第 ${r.line} 行：经纬度超出有效范围 (${a}, ${b})，已跳过`);
        continue;
      }
      let x = a, y = b;
      if (r.latlon) {
        if (!ref) ref = { lat: a, lon: b };
        const m = Geo.toMeters(a, b, ref.lat, ref.lon);
        x = m.x; y = m.y;
      }
      let speed = parseFloat(r.speed);
      if (!isFinite(speed)) speed = null;
      points.push({ t, x, y, speed });
    }
    points.sort((p, q) => p.t - q.t);
    // 缺失速度时由相邻点推算（km/h）
    for (let i = 0; i < points.length; i++) {
      if (points[i].speed != null) continue;
      const q = points[i + 1];
      if (q && q.t > points[i].t) {
        points[i].speed = Geo.dist(points[i], q) / (q.t - points[i].t) * 3.6;
      } else if (i > 0 && points[i].t > points[i - 1].t) {
        points[i].speed = Geo.dist(points[i], points[i - 1]) / (points[i].t - points[i - 1].t) * 3.6;
      }
    }
    return { points, warnings };
  }

  // ---------- 推演调度 ----------
  let timer = null;
  function scheduleRun() {
    if (!$("chk-autorun").checked) return;
    clearTimeout(timer);
    timer = setTimeout(runSimulation, 250);
  }

  function runSimulation() {
    const res = Engine.simulate(state.fences, state.points);
    state.events = res.events;
    state.suppressed = res.suppressed;
    view.events = state.events;
    renderTimeline();
    renderSuppressed();
    view.render();
  }

  // ---------- 事件展示 ----------
  function renderTimeline() {
    const el = $("timeline");
    el.innerHTML = "";
    $("event-count").textContent =
      `共 ${state.events.length} 个事件 · ${state.points.length} 个轨迹点`;
    if (!state.events.length) {
      el.innerHTML = '<p class="muted">暂无事件。导入轨迹并点击“重新推演”。</p>';
      return;
    }
    state.events.forEach((ev, i) => {
      const div = document.createElement("div");
      div.className = "evt " + ev.type;
      div.innerHTML = `<div class="t">${Geo.fmtTime(ev.t)}</div>
        <div class="kind">${ev.typeLabel} · ${ev.fenceName}</div>
        <div class="muted">(${ev.x.toFixed(0)}, ${ev.y.toFixed(0)})</div>`;
      div.onclick = () => {
        state.selectedEvent = i;
        document.querySelectorAll(".evt").forEach((n, j) =>
          n.classList.toggle("selected", j === i));
        view.highlight = { x: ev.x, y: ev.y };
        $("event-detail").textContent =
          `${Geo.fmtTime(ev.t)}  ${ev.typeLabel} @ ${ev.fenceName}\n` +
          `触发位置：(${ev.x.toFixed(1)}, ${ev.y.toFixed(1)}) m，轨迹点 #${ev.pointIndex}\n` +
          `判定依据：${ev.reason}`;
        view.render();
      };
      el.appendChild(div);
    });
  }

  function renderSuppressed() {
    const panel = $("suppressed-panel");
    const el = $("suppressed");
    el.innerHTML = "";
    if (!state.suppressed.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    for (const s of state.suppressed) {
      const div = document.createElement("div");
      div.className = "supp";
      div.textContent = `${Geo.fmtTime(s.t)}  ${s.typeLabel}候选 @ ${s.fenceName}：${s.reason}`;
      el.appendChild(div);
    }
  }

  function renderWarnings() {
    const panel = $("warnings-panel");
    const el = $("warnings");
    el.innerHTML = "";
    if (!state.warnings.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    for (const w of state.warnings) {
      const li = document.createElement("li");
      li.textContent = w;
      el.appendChild(li);
    }
  }

  // ---------- 工具栏与导入 ----------
  function setMode(m) {
    view.mode = m;
    for (const id of ["btn-draw", "btn-edit", "btn-pan"])
      $(id).classList.toggle("active", id === "btn-" + m);
    $("map-hint").textContent = {
      draw: "绘制模式：连续点击添加顶点，双击或回车完成，Esc 取消",
      edit: "编辑模式：点击围栏选中；拖拽顶点调整；右键顶点删除；滚轮缩放",
      pan: "平移模式：拖拽平移，滚轮缩放"
    }[m];
  }
  $("btn-draw").onclick = () => setMode("draw");
  $("btn-edit").onclick = () => setMode("edit");
  $("btn-pan").onclick = () => setMode("pan");
  $("btn-run").onclick = () => runSimulation();

  function importText(text) {
    const res = parseTrack(text);
    state.points = res.points;
    state.warnings = res.warnings;
    view.points = state.points;
    renderWarnings();
    view.fit();
    runSimulation();
  }
  $("btn-import").onclick = () => importText($("import-text").value);
  $("import-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { $("import-text").value = rd.result; importText(rd.result); };
    rd.readAsText(file);
  });
  $("btn-clear-track").onclick = () => {
    state.points = []; state.warnings = [];
    view.points = []; $("import-text").value = "";
    renderWarnings(); runSimulation(); view.render();
  };

  // ---------- 示例场景 ----------
  // 两个重叠围栏 + 一条含抖动、短暂穿越、停留、超速的轨迹
  $("btn-sample").onclick = () => {
    state.fences = []; state.nextFenceId = 1;
    const a = addFence([[-150, -80], [60, -80], [60, 100], [-150, 100]]);
    a.name = "仓库区"; a.priority = 1;
    a.rules.overspeed.enabled = true; a.rules.overspeed.maxKmh = 30;
    a.rules.dwell.seconds = 40; a.minDwellSec = 10; a.minGapSec = 6;
    const b = addFence([[0, -40], [200, -40], [200, 140], [0, 140]]);
    b.name = "装卸区"; b.priority = 2;
    b.rules.dwell.seconds = 30; b.minDwellSec = 12; b.minGapSec = 6;
    view.selectedFenceId = a.id;
    const rows = ["time,x,y,speed"];
    const t0 = new Date("2026-09-22T10:00:00").getTime() / 1000;
    const push = (i, x, y, v) =>
      rows.push(`${new Date((t0 + i * 5) * 1000).toISOString()},${x},${y},${v}`);
    // 从西侧接近并进入仓库区
    for (let i = 0; i < 8; i++) push(i, -260 + i * 18, 10, 25);
    // 边界抖动：在 x=-150 边界附近内外摆动，每次出界 < 6s
    push(8, -148, 12, 20); push(9, -154, 14, 20); push(10, -146, 12, 20);
    // 内部停留（超过 40s 阈值）
    for (let i = 11; i < 24; i++) push(i, -100 + (i % 3) * 4, 30 + (i % 2) * 4, 2);
    // 向东穿越重叠区进入装卸区，途中超速
    for (let i = 24; i < 34; i++) push(i, -80 + (i - 24) * 22, 40, i < 30 ? 55 : 28);
    // 短暂穿越装卸区北缘（< 12s，应被过滤）
    push(34, 150, 138, 30); push(35, 160, 150, 30); push(36, 170, 138, 30);
    // 回到装卸区内停留后离开
    for (let i = 37; i < 48; i++) push(i, 120, 60, 5);
    for (let i = 48; i < 56; i++) push(i, 120 + (i - 48) * 25, 60, 30);
    // 返程短暂穿越装卸区南缘（5s < 最小停留 12s，应被过滤）
    push(56, 300, 145, 30); push(57, 250, 145, 30);
    push(58, 190, 138, 30); push(59, 150, 145, 30); push(60, 100, 145, 30);
    // 混入无效数据行，验证跳过与提示
    rows.push(",170,60,30");
    rows.push("2026-09-22T10:05:00,abc,60,30");
    $("import-text").value = rows.join("\n");
    importText($("import-text").value);
    renderFenceList(); renderFenceForm(a);
  };

  // 初始化
  renderFenceList();
  view.render();
})();
