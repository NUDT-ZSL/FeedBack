/* 收支情景推演 —— 纯前端确定性引擎。
 * 同一组（计划 + 参数）输入永远得到同一份结果，
 * 因此缺口时点与原因不会因无关改动而漂移。 */

const DAY = 86400000;

const defaultEntries = [
  { id: 1, name: "工资",       kind: "income",  amount: 12000, start: offsetDate(5),  recur: "monthly",   end: "" },
  { id: 2, name: "兼职收入",   kind: "income",  amount: 2500,  start: offsetDate(18), recur: "monthly",   end: "" },
  { id: 3, name: "房租",       kind: "expense", amount: 4500,  start: offsetDate(3),  recur: "monthly",   end: "" },
  { id: 4, name: "生活开销",   kind: "expense", amount: 3000,  start: offsetDate(8),  recur: "monthly",   end: "" },
  { id: 5, name: "保险费",     kind: "expense", amount: 6000,  start: offsetDate(25), recur: "quarterly", end: "" },
  { id: 6, name: "家电购置",   kind: "expense", amount: 8000,  start: offsetDate(40), recur: "once",      end: "" }
];

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}
function toISO(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
/* 按月/按季推进：保持“每月第 N 天”，月末日期自动收敛（如 31 日 -> 2 月 28 日） */
function addMonthsClamped(d, months) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

let state = loadState();

function loadState() {
  const fallback = {
    initialBalance: 20000,
    safetyLine: 5000,
    horizonMonths: 24,
    entries: defaultEntries,
    scenario: { incomeDelay: 0, expenseAdvance: 0, amountUplift: 0, upliftTarget: "expense" }
  };
  try {
    const raw = localStorage.getItem("cashflow-sandbox");
    if (!raw) return fallback;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.entries)) return fallback;
    return Object.assign(fallback, s, { scenario: Object.assign(fallback.scenario, s.scenario || {}) });
  } catch (e) { return fallback; }
}
function saveState() { localStorage.setItem("cashflow-sandbox", JSON.stringify(state)); }

/* ---------- 推演引擎 ---------- */

/* 把一笔收支按重复规律展开成具体日期事件 */
function expandEntry(entry, horizonStart, horizonEnd) {
  const events = [];
  if (!entry.start || !(entry.amount > 0)) return events;
  const stepMonths = entry.recur === "monthly" ? 1 : entry.recur === "quarterly" ? 3 : 0;
  let cur = parseISO(entry.start);
  const endLimit = entry.end ? parseISO(entry.end) : horizonEnd;
  let guard = 0;
  while (cur <= horizonEnd && cur <= endLimit && guard < 2000) {
    if (cur >= horizonStart) {
      events.push({ date: toISO(cur), name: entry.name, kind: entry.kind, amount: entry.amount, entryId: entry.id });
    }
    if (stepMonths === 0) break;
    cur = addMonthsClamped(cur, stepMonths);
    guard++;
  }
  return events;
}

/* 情景叠加：收入顺延、支出提前、金额上浮，三者同时作用于同一副本 */
function applyScenario(events, sc) {
  const factor = 1 + sc.amountUplift / 100;
  return events.map(ev => {
    let date = ev.date, amount = ev.amount;
    if (ev.kind === "income") date = toISO(addDays(parseISO(date), sc.incomeDelay));
    if (ev.kind === "expense") date = toISO(addDays(parseISO(date), -sc.expenseAdvance));
    const hit = sc.upliftTarget === "both" || sc.upliftTarget === ev.kind;
    if (hit) amount = Math.round(amount * factor * 100) / 100;
    return Object.assign({}, ev, { date, amount });
  });
}

/* 逐日推进：每日余额 + 累计缺口 + 首次跌破信息 */
function simulate(events, initialBalance, safetyLine, horizonStart, horizonEnd) {
  const byDate = {};
  for (const ev of events) {
    if (ev.date < toISO(horizonStart) || ev.date > toISO(horizonEnd)) continue;
    (byDate[ev.date] = byDate[ev.date] || []).push(ev);
  }
  const days = [];
  let balance = initialBalance, cumGap = 0;
  let breach = null, lastSafeDate = toISO(horizonStart);
  for (let d = new Date(horizonStart); d <= horizonEnd; d = addDays(d, 1)) {
    const iso = toISO(d);
    const todays = byDate[iso] || [];
    for (const ev of todays) balance += ev.kind === "income" ? ev.amount : -ev.amount;
    balance = Math.round(balance * 100) / 100;
    const gap = Math.max(0, safetyLine - balance);
    cumGap = Math.round((cumGap + gap) * 100) / 100;
    days.push({ date: iso, balance, gap, cumGap, events: todays });
    if (balance >= safetyLine) lastSafeDate = iso;
    if (!breach && balance < safetyLine) {
      breach = { date: iso, balance, lastSafeDate };
    }
  }
  if (breach) {
    /* 触发原因：从最后一次高于安全线到跌破当日之间共同作用的全部收支 */
    breach.contributors = [];
    for (const day of days) {
      if (day.date > breach.lastSafeDate && day.date <= breach.date) {
        for (const ev of day.events) breach.contributors.push(ev);
      }
      if (day.date > breach.date) break;
    }
  }
  return { days, breach, cumGap, minBalance: days.reduce((m, x) => Math.min(m, x.balance), Infinity) };
}

/* ---------- 渲染与交互 ---------- */

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });

let nextId = state.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;

function renderEntryTable() {
  const body = $("entryBody");
  body.innerHTML = "";
  for (const e of state.entries) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      '<td><input type="text" data-f="name" value="' + escapeHtml(e.name) + '"></td>' +
      '<td><select data-f="kind">' +
        '<option value="income"' + (e.kind === "income" ? " selected" : "") + '>收入</option>' +
        '<option value="expense"' + (e.kind === "expense" ? " selected" : "") + '>支出</option>' +
      '</select></td>' +
      '<td><input type="number" data-f="amount" min="0" step="100" value="' + e.amount + '"></td>' +
      '<td><input type="date" data-f="start" value="' + e.start + '"></td>' +
      '<td><select data-f="recur">' +
        '<option value="once"' + (e.recur === "once" ? " selected" : "") + '>一次性</option>' +
        '<option value="monthly"' + (e.recur === "monthly" ? " selected" : "") + '>按月</option>' +
        '<option value="quarterly"' + (e.recur === "quarterly" ? " selected" : "") + '>按季</option>' +
      '</select></td>' +
      '<td><input type="date" data-f="end" value="' + (e.end || "") + '"></td>' +
      '<td><button class="del" title="删除">×</button></td>';
    tr.querySelectorAll("[data-f]").forEach(el => {
      el.addEventListener("input", () => {
        const f = el.dataset.f;
        e[f] = f === "amount" ? Number(el.value) || 0 : el.value;
        update();
      });
    });
    tr.querySelector(".del").addEventListener("click", () => {
      state.entries = state.entries.filter(x => x.id !== e.id);
      renderEntryTable();
      update();
    });
    body.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function bindGlobals() {
  $("initialBalance").value = state.initialBalance;
  $("safetyLine").value = state.safetyLine;
  $("horizonMonths").value = state.horizonMonths;
  $("initialBalance").addEventListener("input", e => { state.initialBalance = Number(e.target.value) || 0; update(); });
  $("safetyLine").addEventListener("input", e => { state.safetyLine = Number(e.target.value) || 0; update(); });
  $("horizonMonths").addEventListener("input", e => {
    state.horizonMonths = Math.min(60, Math.max(1, Number(e.target.value) || 12)); update();
  });

  const sc = state.scenario;
  const bind = (id, key, label) => {
    $(id).value = sc[key];
    $(label).textContent = sc[key];
    $(id).addEventListener("input", e => {
      sc[key] = Number(e.target.value);
      $(label).textContent = sc[key];
      update();
    });
  };
  bind("incomeDelay", "incomeDelay", "incomeDelayVal");
  bind("expenseAdvance", "expenseAdvance", "expenseAdvanceVal");
  bind("amountUplift", "amountUplift", "upliftVal");
  $("upliftTarget").value = sc.upliftTarget;
  $("upliftTarget").addEventListener("input", e => { sc.upliftTarget = e.target.value; update(); });
  $("resetScenario").addEventListener("click", () => {
    Object.assign(sc, { incomeDelay: 0, expenseAdvance: 0, amountUplift: 0 });
    ["incomeDelay", "expenseAdvance", "amountUplift"].forEach(k => {
      $(k).value = 0;
    });
    $("incomeDelayVal").textContent = 0;
    $("expenseAdvanceVal").textContent = 0;
    $("upliftVal").textContent = 0;
    update();
  });
  $("addEntry").addEventListener("click", () => {
    state.entries.push({ id: nextId++, name: "新收支", kind: "expense", amount: 1000,
      start: toISO(new Date()), recur: "monthly", end: "" });
    renderEntryTable();
    update();
  });
}

/* ---------- 主刷新：任何输入变化都走同一条确定性管线 ---------- */

function currentHorizon() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = addMonthsClamped(start, state.horizonMonths);
  return { start, end };
}

function update() {
  saveState();
  const { start, end } = currentHorizon();
  const baseEvents = state.entries.flatMap(e => expandEntry(e, start, end));
  const scenEvents = applyScenario(baseEvents, state.scenario);
  const base = simulate(baseEvents, state.initialBalance, state.safetyLine, start, end);
  const scen = simulate(scenEvents, state.initialBalance, state.safetyLine, start, end);
  drawChart(base, scen);
  renderStats(base, scen);
  renderBreach(scen);
}

function renderStats(base, scen) {
  const el = $("stats");
  const b = scen.breach;
  el.innerHTML =
    stat("情景期末余额", fmt(scen.days.length ? scen.days[scen.days.length - 1].balance : state.initialBalance),
      scen.days.length && scen.days[scen.days.length - 1].balance >= state.safetyLine) +
    stat("情景最低余额", fmt(scen.minBalance === Infinity ? state.initialBalance : scen.minBalance),
      (scen.minBalance === Infinity ? state.initialBalance : scen.minBalance) >= state.safetyLine) +
    stat("情景累计缺口", fmt(scen.cumGap), scen.cumGap <= 0) +
    stat("基准累计缺口", fmt(base.cumGap), base.cumGap <= 0) +
    (b
      ? '<div class="stat bad">首次跌破安全线<b>' + b.date + "</b></div>"
      : '<div class="stat ok">首次跌破安全线<b>未发生</b></div>');
  function stat(label, val, ok) {
    return '<div class="stat ' + (ok ? "ok" : "bad") + '">' + label + "<b>" + val + "</b></div>";
  }
}

function renderBreach(scen) {
  const el = $("breachPanel");
  const b = scen.breach;
  if (!b) {
    el.innerHTML = '<div class="breach-head safe"><span class="d">当前情景下余额始终不低于安全线，无缺口。</span></div>';
    return;
  }
  let html = '<div class="breach-head"><span class="d">首次跌破日期：' + b.date +
    "　当时余额：" + fmt(b.balance) + "（安全线 " + fmt(state.safetyLine) + "）</span><br>" +
    '<span class="hint">触发原因：自 ' + b.lastSafeDate +
    "（最后一次高于安全线）至跌破当日，以下收支共同作用导致余额下穿安全线：</span></div>";
  html += '<table class="contrib"><thead><tr><th>日期</th><th>名称</th><th>类型</th><th>金额（情景后）</th></tr></thead><tbody>';
  for (const ev of b.contributors) {
    const sign = ev.kind === "income" ? "+" : "-";
    html += "<tr><td>" + ev.date + "</td><td>" + escapeHtml(ev.name) + "</td><td>" +
      (ev.kind === "income" ? "收入" : "支出") + '</td><td class="' +
      (ev.kind === "income" ? "in" : "out") + '">' + sign + fmt(ev.amount) + "</td></tr>";
  }
  html += "</tbody></table>";
  el.innerHTML = html;
}

/* ---------- 曲线绘制（Canvas，无外部依赖） ---------- */

function drawChart(base, scen) {
  const cv = $("chart");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const padL = 70, padR = 16, padT = 16, padB = 34;
  ctx.clearRect(0, 0, W, H);
  const days = scen.days;
  if (!days.length) return;
  const all = base.days.concat(days).map(d => d.balance).concat([state.safetyLine]);
  let min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  const span = Math.max(1, max - min);
  min -= span * 0.08; max += span * 0.08;
  const x = i => padL + (W - padL - padR) * (i / (days.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));

  ctx.strokeStyle = "#dfe5ee"; ctx.fillStyle = "#667"; ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let g = 0; g <= 4; g++) {
    const v = min + (max - min) * g / 4, yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText(fmt(v), padL - 6, yy + 4);
  }
  ctx.textAlign = "center";
  const tickEvery = Math.max(1, Math.floor(days.length / 8));
  for (let i = 0; i < days.length; i += tickEvery) {
    ctx.fillText(days[i].date.slice(0, 7), x(i), H - 12);
  }

  line(base.days, "#7f8c9b", 1.5);
  line(days, "#2471c8", 2);

  ctx.strokeStyle = "#e67e22"; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(padL, y(state.safetyLine)); ctx.lineTo(W - padR, y(state.safetyLine)); ctx.stroke();
  ctx.setLineDash([]);

  if (scen.breach) {
    const idx = days.findIndex(d => d.date === scen.breach.date);
    if (idx >= 0) {
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.arc(x(idx), y(scen.breach.balance), 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x(idx), y(scen.breach.balance), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function line(series, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    series.forEach((d, i) => { i ? ctx.lineTo(x(i), y(d.balance)) : ctx.moveTo(x(i), y(d.balance)); });
    ctx.stroke();
  }
}

/* ---------- 启动 ---------- */

renderEntryTable();
bindGlobals();
update();
