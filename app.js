'use strict';

const STORAGE_KEY = 'cashflow-scenario-lab-v1';
const $ = (id) => document.getElementById(id);
const RECURRENCE_LABEL = { monthly: '按月', quarterly: '按季', once: '一次性' };
const TYPE_LABEL = { income: '收入', expense: '支出' };

function createSampleState() {
  return {
    openingBalance: 18000, safetyLine: 5000, startDate: '2026-10-01', endDate: '2027-03-31',
    scenario: { incomeDelayDays: 7, expenseAdvanceDays: 5, expenseIncreasePct: 8 },
    entries: [
      { id: 'salary', name: '工资', type: 'income', amount: 16000, startDate: '2026-10-10', endDate: '2027-03-10', recurrence: 'monthly' },
      { id: 'project', name: '季度项目款', type: 'income', amount: 4200, startDate: '2026-11-20', endDate: '2027-02-20', recurrence: 'quarterly' },
      { id: 'rent', name: '房租', type: 'expense', amount: 6800, startDate: '2026-10-05', endDate: '2027-03-05', recurrence: 'monthly' },
      { id: 'team', name: '外包协作费', type: 'expense', amount: 5200, startDate: '2026-10-12', endDate: '2027-03-12', recurrence: 'monthly' },
      { id: 'utilities', name: '水电与软件订阅', type: 'expense', amount: 1200, startDate: '2026-10-08', endDate: '2027-03-08', recurrence: 'monthly' },
      { id: 'equipment', name: '设备采购', type: 'expense', amount: 3800, startDate: '2026-11-15', endDate: '', recurrence: 'once' }
    ]
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.entries) && saved.startDate) {
      const sample = createSampleState();
      return { ...sample, ...saved, scenario: { ...sample.scenario, ...(saved.scenario || {}) } };
    }
  } catch (error) { console.warn('本地计划读取失败，已载入示例', error); }
  return createSampleState();
}

let state = loadState();
let latestResult = null;
let chartMetric = 'balance';

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}
function money(value) {
  const n = Number(value || 0);
  return `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function compactMoney(value) {
  const n = Number(value || 0), abs = Math.abs(n);
  const text = abs >= 10000 ? `${(abs / 10000).toFixed(abs >= 100000 ? 0 : 1)}万`
    : abs >= 1000 ? `${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k` : Math.round(abs).toString();
  return `${n < 0 ? '-' : ''}¥${text}`;
}
function setValue(id, value) { $(id).value = value; }
function syncForm() {
  ['openingBalance', 'safetyLine', 'startDate', 'endDate'].forEach((id) => setValue(id, state[id]));
  Object.keys(state.scenario).forEach((id) => setValue(id, state.scenario[id]));
}
function makeInput(entry, field, type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.value = entry[field] ?? '';
  input.dataset.entryId = entry.id;
  input.dataset.field = field;
  if (field === 'amount') input.step = '0.01';
  return input;
}

function renderEntries() {
  const body = $('entriesBody');
  body.textContent = '';
  state.entries.forEach((entry) => {
    const tr = document.createElement('tr');
    const td = (node) => { const cell = document.createElement('td'); cell.append(node); return cell; };
    tr.append(td(makeInput(entry, 'name')));
    const type = document.createElement('select');
    Object.entries(TYPE_LABEL).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; type.append(option);
    });
    type.value = entry.type; type.dataset.entryId = entry.id; type.dataset.field = 'type';
    tr.append(td(type));
    tr.append(td(makeInput(entry, 'amount', 'number')));
    tr.append(td(makeInput(entry, 'startDate', 'date')));
    tr.append(td(makeInput(entry, 'endDate', 'date')));
    const recurrence = document.createElement('select');
    Object.entries(RECURRENCE_LABEL).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; recurrence.append(option);
    });
    recurrence.value = entry.recurrence; recurrence.dataset.entryId = entry.id; recurrence.dataset.field = 'recurrence';
    tr.append(td(recurrence));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'icon-btn'; remove.textContent = '×'; remove.title = '删除';
    remove.dataset.removeEntry = entry.id;
    tr.append(td(remove));
    body.append(tr);
  });
}

function renderSummary(result) {
  $('finalBalance').textContent = money(result.finalBalance);
  $('finalBalance').style.color = result.finalBalance < 0 ? 'var(--danger)' : '';
  $('maxGap').textContent = money(result.maxCumulativeGap);
  $('maxGap').style.color = result.maxCumulativeGap > 0 ? 'var(--danger)' : '';
  const breachCard = document.querySelector('.breach-card');
  breachCard.classList.toggle('danger', result.breached);
  $('breachDate').textContent = result.breached ? result.firstBreach.date : '未跌破';
  $('breachBalance').textContent = result.breached ? `余额 ${money(result.firstBreach.balance)} · 缺口 ${money(result.firstBreach.gap)}` : '';
  const summary = $('breachSummary');
  summary.classList.toggle('danger', result.breached);
  summary.textContent = result.breached
    ? `首次跌破：${result.firstBreach.date}，安全线 ${money(result.firstBreach.safetyLine)}，当时余额 ${money(result.firstBreach.balance)}。${result.firstBreach.summary}`
    : '当前参数下，整个推演区间内余额均未跌破安全线。';
}

function renderFactors(result) {
  const wrap = $('factorPills');
  wrap.textContent = '';
  if (!result.breached) return;
  result.firstBreach.factors.forEach((factor) => {
    const pill = document.createElement('span');
    pill.className = 'factor-pill';
    pill.textContent = `${factor.label} · ${money(factor.total)}`;
    wrap.append(pill);
  });
}
function renderTrace(result) {
  const body = $('traceBody');
  body.textContent = '';
  if (!result.breached) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 8;
    cell.textContent = '无需追溯：没有出现安全线缺口。';
    cell.style.color = 'var(--muted)';
    row.append(cell);
    body.append(row);
    return;
  }
  result.firstBreach.events.forEach((event) => {
    const tr = document.createElement('tr');
    const td = (text, cls = '') => {
      const cell = document.createElement('td');
      cell.textContent = text;
      if (cls) cell.className = cls;
      return cell;
    };
    tr.append(td(event.name));
    tr.append(td(TYPE_LABEL[event.type], event.type === 'income' ? 'type-income' : 'type-expense'));
    tr.append(td(event.baseDate));
    tr.append(td(event.date > result.firstBreach.date ? `${event.date}（未到）` : event.date));
    tr.append(td(money(event.baseAmount)));
    tr.append(td(money(event.amount)));
    tr.append(td(event.adverseImpact > 0 ? `-${money(event.adverseImpact)}` : '—', event.adverseImpact > 0 ? 'impact-negative' : ''));
    const reasonCell = document.createElement('td');
    event.tags.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = tag.label;
      reasonCell.append(span);
    });
    tr.append(reasonCell);
    body.append(tr);
  });
}

function showError(error) {
  $('validation').textContent = error.message;
  $('validation').classList.add('show');
  $('finalBalance').textContent = '--';
  $('maxGap').textContent = '--';
  $('breachDate').textContent = '无法推演';
  $('breachBalance').textContent = '请检查输入';
  $('breachSummary').textContent = error.message;
  $('factorPills').textContent = '';
  $('traceBody').textContent = '';
  $('chart').textContent = '';
}

function update(renderRows = true) {
  try {
    latestResult = window.CashflowEngine.runSimulation(state);
    $('validation').classList.remove('show');
    renderSummary(latestResult);
    renderFactors(latestResult);
    renderTrace(latestResult);
    renderChart(latestResult);
    persist();
    if (renderRows) renderEntries();
  } catch (error) {
    persist();
    showError(error);
  }
}
function renderChart(result) {
  const svg = $('chart');
  svg.textContent = '';
  const W = 920, H = 390, M = { top: 24, right: 24, bottom: 42, left: 72 };
  const PW = W - M.left - M.right, PH = H - M.top - M.bottom;
  const sd = result.scenario.days, bd = result.baseline.days, gapView = chartMetric === 'gap';
  const values = sd.map((d) => gapView ? d.cumulativeGap : d.balance);
  if (!gapView) values.push(...bd.map((d) => d.balance), result.safetyLine);
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * .08; min -= pad; max += pad;
  const x = (i) => M.left + (sd.length === 1 ? PW / 2 : i * PW / (sd.length - 1));
  const y = (v) => M.top + (max - v) * PH / (max - min);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}) => {
    const node = document.createElementNS(ns, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };
  for (let i = 0; i <= 5; i += 1) {
    const value = min + (max - min) * i / 5, yy = y(value);
    svg.append(el('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy, stroke: '#edf1f7' }));
    const t = el('text', { x: M.left - 10, y: yy + 4, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = compactMoney(value); svg.append(t);
  }
  const ticks = Math.min(7, sd.length);
  for (let i = 0; i < ticks; i += 1) {
    const idx = Math.round(i * (sd.length - 1) / Math.max(1, ticks - 1));
    const t = el('text', { x: x(idx), y: H - 15, 'text-anchor': 'middle', class: 'axis-label' });
    t.textContent = sd[idx].date.slice(5).replace('-', '/'); svg.append(t);
  }
  if (!gapView) {
    svg.append(el('line', { x1: M.left, x2: W - M.right, y1: y(result.safetyLine), y2: y(result.safetyLine), stroke: '#f79009', 'stroke-width': 2, 'stroke-dasharray': '7 6' }));
  } else {
    svg.append(el('line', { x1: M.left, x2: W - M.right, y1: y(0), y2: y(0), stroke: '#98a2b3', 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
  }
  const path = (days) => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(gapView ? d.cumulativeGap : d.balance).toFixed(1)}`).join(' ');
  svg.append(el('path', { d: path(bd), fill: 'none', stroke: '#98a2b3', 'stroke-width': 2.2, 'stroke-dasharray': '6 5' }));
  svg.append(el('path', { d: path(sd), fill: 'none', stroke: '#2457e6', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  if (result.breached) {
    const idx = sd.findIndex((d) => d.date === result.firstBreach.date), bx = x(idx), by = y(sd[idx].balance);
    svg.append(el('line', { x1: bx, x2: bx, y1: M.top, y2: H - M.bottom, stroke: '#d92d20', 'stroke-dasharray': '4 4' }));
    svg.append(el('circle', { cx: bx, cy: by, r: 6, fill: '#d92d20', stroke: '#fff', 'stroke-width': 3 }));
    const t = el('text', { x: Math.min(bx + 10, W - M.right - 130), y: Math.max(M.top + 16, by - 12), fill: '#d92d20', class: 'breach-label' });
    t.textContent = `首次缺口 ${result.firstBreach.date}`; svg.append(t);
  }
  const hit = el('rect', { x: M.left, y: M.top, width: PW, height: PH, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    const px = (event.clientX - rect.left) * W / rect.width;
    const i = Math.max(0, Math.min(sd.length - 1, Math.round((px - M.left) / PW * (sd.length - 1))));
    const d = sd[i], b = bd[i], tip = $('tooltip');
    tip.hidden = false;
    tip.style.left = `${x(i) / W * 100}%`;
    tip.style.top = `${y(gapView ? d.cumulativeGap : d.balance) / H * 100}%`;
    tip.innerHTML = `<strong>${d.date}</strong><span><b>情景余额</b>${money(d.balance)}</span><span><b>基准余额</b>${money(b.balance)}</span><span><b>当日收入</b>${money(d.income)}</span><span><b>当日支出</b>${money(d.expense)}</span><span><b>累计缺口</b>${money(d.cumulativeGap)}</span>`;
  });
  hit.addEventListener('mouseleave', () => { $('tooltip').hidden = true; });
}
function updateEntry(id, field, value) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  entry[field] = value;
  if (field === 'recurrence' && value === 'once') entry.endDate = '';
  update(field === 'recurrence' || field === 'type');
}

function addEntry(type) {
  state.entries.push({
    id: `entry-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    name: type === 'income' ? '新收入' : '新支出',
    type, amount: 1000, startDate: state.startDate, endDate: '', recurrence: 'monthly'
  });
  update();
}

function bindEvents() {
  ['openingBalance', 'safetyLine', 'startDate', 'endDate'].forEach((id) => {
    $(id).addEventListener('input', () => { state[id] = $(id).value; update(false); });
  });
  Object.keys(state.scenario).forEach((field) => {
    $(field).addEventListener('input', () => { state.scenario[field] = $(field).value; update(false); });
  });
  $('entriesBody').addEventListener('input', (event) => {
    const target = event.target;
    if (target.dataset.entryId) updateEntry(target.dataset.entryId, target.dataset.field, target.value);
  });
  $('entriesBody').addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.entryId) updateEntry(target.dataset.entryId, target.dataset.field, target.value);
  });
  $('entriesBody').addEventListener('click', (event) => {
    const id = event.target.dataset.removeEntry;
    if (id) {
      state.entries = state.entries.filter((entry) => entry.id !== id);
      update();
    }
  });
  $('addIncome').addEventListener('click', () => addEntry('income'));
  $('addExpense').addEventListener('click', () => addEntry('expense'));
  $('resetSample').addEventListener('click', () => { state = createSampleState(); syncForm(); update(); });
  $('clearPlan').addEventListener('click', () => {
    state = { ...state, entries: [], scenario: { incomeDelayDays: 0, expenseAdvanceDays: 0, expenseIncreasePct: 0 } };
    syncForm();
    update();
  });
  document.querySelectorAll('[data-metric]').forEach((button) => {
    button.addEventListener('click', () => {
      chartMetric = button.dataset.metric;
      document.querySelectorAll('[data-metric]').forEach((b) => b.classList.toggle('active', b === button));
      renderChart(latestResult);
    });
  });
}

const style = document.createElement('style');
style.textContent = '.axis-label{font-size:12px;fill:#667085}.breach-label{font-size:13px;font-weight:700}';
document.head.append(style);
syncForm();
renderEntries();
bindEvents();
update(false);
