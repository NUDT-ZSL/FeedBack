/* app.js —— 界面逻辑。零依赖，使用全局 FocusCore（见 core.js）。 */
(() => {
  'use strict';
  const C = window.FocusCore;
  const STORE_KEY = 'focus-recovery-workbench-v1';
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

  // ---------------- 状态 ----------------
  let state = loadState();   // { session, idCounter }
  let notices = [];          // {kind, html}

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* 损坏则退回示例 */ }
    return { session: buildSampleSession(), idCounter: 100 };
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function uid(prefix) {
    state.idCounter = (state.idCounter || 0) + 1;
    let id = `${prefix}${state.idCounter}`;
    const allIds = new Set();
    state.session.stages.forEach((s) => allIds.add(s.id));
    state.session.interruptions.forEach((i) => { allIds.add(i.id); i.sources.forEach((s) => allIds.add(s.id)); });
    while (allIds.has(id)) { state.idCounter++; id = `${prefix}${state.idCounter}`; }
    return id;
  }

  // ---------------- 时间工具 ----------------
  function parseTime(str) {
    if (str == null) return NaN;
    const s = String(str).trim();
    if (s === '') return NaN;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s); // 直接给分钟数
    const m = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function fmtClock(min) {
    if (!Number.isFinite(min)) return '—';
    const sign = min < 0 ? '-' : '';
    const v = Math.abs(Math.round(min));
    const h = Math.floor(v / 60), m = v % 60;
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const fmtN = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—');
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---------------- 示例数据 ----------------
  function buildSampleSession() {
    return C.createSession({
      name: '下午专注会话',
      nowMinutes: 80,
      stages: [
        C.makeStage({ id: 'stg-read', name: '阅读资料', budgetMinutes: 40, order: 1, status: C.STAGE_STATUS.DONE }),
        C.makeStage({ id: 'stg-write', name: '撰写方案', budgetMinutes: 60, order: 2, status: C.STAGE_STATUS.ACTIVE }),
        C.makeStage({ id: 'stg-review', name: '复盘整理', budgetMinutes: 30, order: 3, status: C.STAGE_STATUS.PENDING }),
      ],
      interruptions: [
        C.makeInterruption({
          id: 'int-call', reason: '紧急来电',
          sources: [
            C.makeSourceRecord({ id: 'src-cal', source: '日历', start: 15, end: 30, resolution: C.RESOLUTION.CONFIRMED }),
            C.makeSourceRecord({ id: 'src-boss', source: '主管', start: 15, end: 30, resolution: C.RESOLUTION.CONFIRMED }),
          ],
        }),
        C.makeInterruption({
          id: 'int-knock', reason: '同事敲门询问',
          sources: [
            C.makeSourceRecord({ id: 'src-im', source: '即时消息', start: 50, end: 55, resolution: C.RESOLUTION.CONFIRMED }),
            C.makeSourceRecord({ id: 'src-cam', source: '监控复核', start: 50, end: 55, resolution: C.RESOLUTION.DISMISSED }),
          ],
        }),
        C.makeInterruption({
          id: 'int-meet', reason: '临时会议',
          sources: [
            C.makeSourceRecord({ id: 'src-talk', source: '同事口头', start: 62, end: 70, resolution: C.RESOLUTION.CONFIRMED }),
            C.makeSourceRecord({ id: 'src-minutes', source: '会议记录', start: 65, end: 75, resolution: C.RESOLUTION.CONFIRMED }),
          ],
        }),
      ],
    });
  }

  // ---------------- 渲染主流程 ----------------
  function render() {
    saveState();
    const derived = C.derive(state.session);
    renderValidation(derived);
    renderResume(derived);
    renderTimeline(derived);
    renderStageTable(derived);
    renderNet(derived);
    renderConflicts(derived);
    renderStageEditor();
    renderInterruptions(derived);
    renderInterruptionSelect();
    renderNow();
  }

  function renderValidation(derived) {
    const stageErrs = derived.errors.filter((e) => e.code === 'BAD_BUDGET' || e.code === 'BAD_ORDER' || e.code === 'DUP_ORDER' || e.code === 'NO_STAGES' || e.code === 'BAD_STATUS');
    const intErrs = derived.errors.filter((e) => !stageErrs.includes(e));
    document.getElementById('stageErrorBox').innerHTML = stageErrs.map((e) => `<div class="field-error">⛔ ${esc(e.message)}</div>`).join('');
    document.getElementById('reportErrorBox').innerHTML = intErrs.map((e) => `<div class="field-error">⛔ ${esc(e.message)}</div>`).join('');
    const chartErr = document.getElementById('chartError');
    if (derived.ok) { chartErr.hidden = true; chartErr.textContent = ''; }
    else {
      chartErr.hidden = false;
      chartErr.textContent = `存在 ${derived.errors.length} 条拒绝记录，时间线与计入结果暂停推导，修正后立即恢复。`;
    }
  }

  function renderResume(derived) {
    const el = document.getElementById('resumeBanner');
    if (!derived.schedule) { el.className = 'resume-banner'; return; }
    const r = derived.schedule.resume;
    if (r.completed) {
      el.className = 'resume-banner show done';
      el.innerHTML = `✅ 所有阶段均已完成，没有需要恢复的位置。`;
    } else {
      el.className = 'resume-banner show';
      el.innerHTML = `▶ 继续进入：<strong>第 ${r.order} 阶段「${esc(r.name)}」</strong>
        —— 该阶段已计入 <strong>${fmtN(r.offsetMinutes)}</strong> 分钟，剩余额度 <strong>${fmtN(r.remainingMinutes)}</strong> 分钟，从这里继续。`;
    }
  }

  function renderNow() {
    document.getElementById('nowInput').value = state.session.nowMinutes == null ? '' : fmtClock(state.session.nowMinutes);
  }

  // ---------------- 阶段汇总表 ----------------
  function renderStageTable(derived) {
    const tb = document.querySelector('#stageTable tbody');
    const stages = [...state.session.stages].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
    const badge = document.getElementById('conservationBadge');
    let allConserve = derived.ok;
    tb.innerHTML = stages.map((s) => {
      const r = derived.schedule?.stages.find((x) => x.stageId === s.id);
      const conserve = r ? Math.abs(r.countedMinutes + r.remainingMinutes - r.budgetMinutes) < 1e-6 : true;
      if (!conserve) allConserve = false;
      const counted = r?.countedMinutes ?? 0;
      const pct = r && r.budgetMinutes ? (counted / r.budgetMinutes) * 100 : 0;
      return `<tr${r && derived.schedule.resume.stageId === s.id ? ' style="outline:2px solid var(--warning);outline-offset:-2px"' : ''}>
        <td>${esc(s.order)}</td>
        <td>${esc(s.name)}</td>
        <td><span class="status-tag status-${esc(s.status)}">${statusLabel(s.status)}</span></td>
        <td class="num">${fmtN(s.budgetMinutes)}</td>
        <td class="num">${r ? `${fmtClock(r.windowStart)}–${fmtClock(r.windowEnd)}` : '—'}</td>
        <td class="num">${r ? fmtN(r.interruptionInWindow) : '—'}</td>
        <td class="num"><strong>${r ? fmtN(r.countedMinutes) : '—'}</strong></td>
        <td class="num bar-cell">
          <span style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
            <span class="mini-bar" style="width:90px"><span class="b-counted" style="width:${pct}%"></span><span class="b-remaining" style="width:${100 - pct}%"></span></span>
            ${r ? fmtN(r.remainingMinutes) : '—'}
          </span>
        </td>
        <td>${r ? (conserve ? '<span class="pill pill-good">守恒 ✓</span>' : '<span class="pill pill-danger">失衡</span>') : '—'}</td>
      </tr>`;
    }).join('');
    badge.className = allConserve ? 'pill pill-good' : 'pill pill-danger';
    badge.textContent = derived.ok ? (allConserve ? '计入 + 剩余 = 预算 ✓' : '守恒异常') : '';
  }

  function statusLabel(st) {
    return { done: '已完成', active: '进行中', pending: '未开始' }[st] || st;
  }

  // ---------------- 净打断 ----------------
  function renderNet(derived) {
    const list = document.getElementById('netList');
    const cnt = document.getElementById('netCount');
    const nets = derived.netIntervals || [];
    cnt.textContent = nets.length ? `${nets.length} 段` : '';
    if (!nets.length) { list.innerHTML = '<div class="empty-hint">暂无已确认净打断区间。待消解或被否决的记录不会出现在这里。</div>'; return; }
    list.innerHTML = nets.map((n) => `
      <div class="net-item" data-tip="${esc(netTooltip(n))}">
        <span class="range">${fmtClock(n.start)} – ${fmtClock(n.end)}</span>
        （${fmtN(n.duration)} 分钟）
        <div class="members">归并来源：${n.members.map((m) => `${esc(m.source)}·${esc(m.reason)}`).join('；')}</div>
      </div>`).join('');
  }
  function netTooltip(n) {
    return `净打断 [${fmtClock(n.start)}, ${fmtClock(n.end)}]，${fmtN(n.duration)} 分钟\n由 ${n.members.length} 条已确认记录归并：\n` +
      n.members.map((m) => `· ${m.source} 报 [${fmtClock(m.start)}, ${fmtClock(m.end)}]（${m.reason}）`).join('\n');
  }

  // ---------------- 冲突 ----------------
  function renderConflicts(derived) {
    const list = document.getElementById('conflictList');
    const cnt = document.getElementById('conflictCount');
    const conflicts = derived.conflicts || [];
    cnt.textContent = conflicts.length ? `${conflicts.length} 起未决` : '';
    cnt.className = conflicts.length ? 'pill pill-danger' : 'pill pill-good';
    if (!conflicts.length) { list.innerHTML = '<div class="empty-hint">无冲突：所有多源记录一致，或已消解。</div>'; return; }
    list.innerHTML = conflicts.map((cf) => {
      const side = (x) => `<div class="conflict-side">
          <div><strong>${esc(x.source)}</strong> <span class="pill">${resolutionLabel(x.resolution)}</span></div>
          <div style="font-variant-numeric:tabular-nums;margin-top:3px">${fmtClock(x.start)} – ${fmtClock(x.end)}</div>
        </div>`;
      return `<div class="conflict-item" data-tip="${esc(cf.message)}">
        <div class="type">${cf.type === 'interval' ? '⚠ 区间矛盾' : '⚖ 消解结论矛盾'} · 打断「${esc(cf.reason)}」</div>
        <div class="sides">${side(cf.a)}${side(cf.b)}</div>
        <div>${esc(cf.message)}</div>
        <div class="conflict-actions">
          <button class="btn btn-mini" data-act="resolve" data-int="${esc(cf.interruptionId)}" data-src="${esc(cf.a.sourceId)}" data-res="confirmed">采纳「${esc(cf.a.source)}」为成立</button>
          <button class="btn btn-mini" data-act="resolve" data-int="${esc(cf.interruptionId)}" data-src="${esc(cf.b.sourceId)}" data-res="dismissed">否决「${esc(cf.b.source)}」</button>
          <button class="btn btn-mini btn-ghost" data-act="resolve" data-int="${esc(cf.interruptionId)}" data-src="${esc(cf.a.sourceId)}" data-res="pending">标为待消解</button>
        </div>
      </div>`;
    }).join('');
  }
  function resolutionLabel(r) {
    return { confirmed: '成立', dismissed: '否决', pending: '待消解' }[r] || r;
  }

  // ---------------- 阶段编辑器 ----------------
  function renderStageEditor() {
    const tb = document.querySelector('#stageEditTable tbody');
    const stages = [...state.session.stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    tb.innerHTML = stages.map((s) => `
      <tr data-stage="${esc(s.id)}">
        <td><input type="number" min="1" step="1" value="${esc(s.order)}" data-f="order"></td>
        <td><input type="text" value="${esc(s.name)}" data-f="name" style="width:130px"></td>
        <td><input type="number" min="0" step="1" value="${esc(s.budgetMinutes)}" data-f="budget" style="width:80px"></td>
        <td>
          <select data-f="status">
            <option value="pending"${s.status === 'pending' ? ' selected' : ''}>未开始</option>
            <option value="active"${s.status === 'active' ? ' selected' : ''}>进行中</option>
            <option value="done"${s.status === 'done' ? ' selected' : ''}>已完成</option>
          </select>
        </td>
        <td><button class="btn btn-mini btn-danger btn-ghost" data-act="del-stage">删除</button></td>
      </tr>`).join('');
  }

  // ---------------- 打断列表 ----------------
  function renderInterruptions(derived) {
    const host = document.getElementById('interruptionList');
    const conflictInts = new Set((derived.conflicts || []).map((c) => c.interruptionId));
    if (!state.session.interruptions.length) { host.innerHTML = '<div class="empty-hint">还没有打断记录。</div>'; return; }
    host.innerHTML = state.session.interruptions.map((it) => `
      <div class="int-item ${conflictInts.has(it.id) ? 'has-conflict' : ''}">
        <div class="int-head">
          <span class="reason">${esc(it.reason)}</span>
          <span class="int-id">${esc(it.id)}</span>
          ${conflictInts.has(it.id) ? '<span class="conflict-flag">⚠ 存在冲突</span>' : ''}
          <button class="btn btn-mini btn-danger btn-ghost" style="margin-left:auto" data-act="del-int" data-int="${esc(it.id)}">删除打断</button>
        </div>
        <table class="src-table">
          <thead><tr><th>来源</th><th>区间</th><th>时长</th><th>消解结论</th><th></th></tr></thead>
          <tbody>
          ${it.sources.map((sr) => `
            <tr>
              <td>${esc(sr.source)}</td>
              <td style="font-variant-numeric:tabular-nums">${fmtClock(sr.start)} – ${fmtClock(sr.end)}</td>
              <td>${fmtN(sr.end - sr.start)} 分</td>
              <td>
                <select class="res-select" data-act="res-select" data-int="${esc(it.id)}" data-src="${esc(sr.id)}">
                  <option value="pending"${sr.resolution === 'pending' ? ' selected' : ''}>待消解</option>
                  <option value="confirmed"${sr.resolution === 'confirmed' ? ' selected' : ''}>确认成立</option>
                  <option value="dismissed"${sr.resolution === 'dismissed' ? ' selected' : ''}>否决</option>
                </select>
              </td>
              <td><button class="btn btn-mini btn-danger btn-ghost" data-act="del-src" data-int="${esc(it.id)}" data-src="${esc(sr.id)}">×</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('');
  }

  function renderInterruptionSelect() {
    const sel = document.getElementById('interruptionSel');
    const cur = sel.value;
    sel.innerHTML = `<option value="__new__">— 新建打断 —</option>` +
      state.session.interruptions.map((it) => `<option value="${esc(it.id)}">${esc(it.reason)}（${esc(it.id)}）</option>`).join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  // ---------------- 时间线 SVG ----------------
  function renderTimeline(derived) {
    const host = document.getElementById('timelineHost');
    if (!derived.ok || !derived.schedule) { host.innerHTML = ''; renderLegend(); return; }
    const sch = derived.schedule;
    const W = Math.max(host.clientWidth - 2, 720);
    const padL = 104, padR = 24, padT = 30, padB = 26;
    const rowH = 34, gap = 10;
    const netLaneH = 26;
    const rows = sch.stages.length;
    const H = padT + rows * (rowH + gap) + netLaneH + 18 + padB;
    const maxT = Math.max(sch.sessionEnd, state.session.nowMinutes ?? 0, 10);
    const x = (t) => padL + (t / maxT) * (W - padL - padR);

    const ticks = makeTicks(maxT);
    let svg = '';
    // 轴刻度与网格
    for (const tk of ticks) {
      const xc = x(tk);
      svg += `<line class="tl-grid" x1="${xc}" y1="${padT - 8}" x2="${xc}" y2="${H - padB + 4}"/>`;
      svg += `<text class="tl-axis" x="${xc}" y="${padT - 12}" text-anchor="middle">${fmtClock(tk)}</text>`;
    }

    sch.stages.forEach((r, i) => {
      const y = padT + i * (rowH + gap);
      const color = SERIES[i % SERIES.length];
      svg += `<text class="tl-label" x="8" y="${y + rowH / 2 + 4}">${r.order}. ${esc(r.name)}</text>`;
      // 占用窗底条
      svg += `<rect class="tl-stage" x="${x(r.windowStart)}" y="${y}" width="${x(r.windowEnd) - x(r.windowStart)}" height="${rowH}"
               fill="var(--surface-2)" stroke="var(--baseline)" data-tip="${esc(stageTip(r))}"/>`;
      // 已计入片段（蓝）
      for (const f of r.countedFragments || []) {
        svg += `<rect class="tl-counted" x="${x(f.start)}" y="${y + 3}" width="${Math.max(0, x(f.end) - x(f.start))}" height="${rowH - 6}" rx="3" data-tip="${esc(stageTip(r))}"/>`;
      }
      // 打断片段（红）
      for (const c of r.cuts) {
        svg += `<rect class="tl-cut" x="${x(c.start)}" y="${y + 3}" width="${Math.max(1, x(c.end) - x(c.start))}" height="${rowH - 6}" rx="2"
                 data-tip="${esc(cutTip(c))}"/>`;
      }
      // 阶段边框（身份色，2px surface 间隔靠内嵌）
      svg += `<rect x="${x(r.windowStart) + 0.5}" y="${y + 0.5}" width="${x(r.windowEnd) - x(r.windowStart) - 1}" height="${rowH - 1}" rx="4"
               fill="none" stroke="${color}" stroke-width="1.6" opacity="0.75"/>`;
      // 直接标签：预算/计入/剩余
      svg += `<text class="tl-sub" x="${x(r.windowEnd) + 6}" y="${y + rowH / 2 + 4}">计${fmtN(r.countedMinutes)}/余${fmtN(r.remainingMinutes)}</text>`;
    });

    // 净打断总览道
    const laneY = padT + rows * (rowH + gap) + 8;
    svg += `<text class="tl-label" x="8" y="${laneY + 16}" style="font-size:11px">净打断</text>`;
    svg += `<line class="tl-grid" x1="${padL}" y1="${laneY + 22}" x2="${W - padR}" y2="${laneY + 22}"/>`;
    for (const n of derived.netIntervals) {
      svg += `<rect class="tl-cut-hatch" x="${x(n.start)}" y="${laneY + 10}" width="${Math.max(1, x(n.end) - x(n.start))}" height="12" rx="3" data-tip="${esc(netTooltip(n))}"/>`;
    }

    // 已计工作前沿
    if (Number.isFinite(sch.frontier)) {
      const xf = x(sch.frontier);
      svg += `<line class="tl-frontier" x1="${xf}" y1="${padT - 8}" x2="${xf}" y2="${laneY + 24}"/>`;
      svg += `<text class="tl-axis" x="${xf}" y="${H - 8}" text-anchor="middle">当前 ${fmtClock(sch.frontier)}</text>`;
    }

    // 恢复位置标记（落在前沿所在的恢复阶段行）
    if (!sch.resume.completed) {
      const r = sch.stages.find((s) => s.stageId === sch.resume.stageId);
      const i = sch.stages.indexOf(r);
      const y = padT + i * (rowH + gap);
      const xf = x(Math.min(sch.frontier, r.windowEnd));
      svg += `<polygon class="tl-resume" points="${xf},${y - 4} ${xf - 5},${y - 12} ${xf + 5},${y - 12}"
               data-tip="恢复位置：第 ${r.order} 阶段「${esc(r.name)}」&#10;已计入 ${fmtN(sch.resume.offsetMinutes)} 分，剩余 ${fmtN(sch.resume.remainingMinutes)} 分"/>`;
    }

    // 冲突标记（在时间线顶部）
    (derived.conflicts || []).forEach((cf, idx) => {
      const ref = cf.overlap || cf.a;
      const xc = x((ref.start + ref.end) / 2);
      svg += `<circle class="tl-conflict" cx="${xc}" cy="${padT - 12}" r="6" data-tip="${esc(cf.message)}"/>
              <text x="${xc}" y="${padT - 8}" text-anchor="middle" font-size="9" fill="#000">!</text>`;
    });

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="阶段时间线">${svg}</svg>`;
    renderLegend();
  }

  function renderLegend() {
    document.getElementById('timelineLegend').innerHTML = `
      <span><i style="background:var(--counted);opacity:.5"></i>已计入工作</span>
      <span><i style="background:var(--surface-2);border:1px solid var(--baseline)"></i>剩余额度/占用窗</span>
      <span><i style="background:var(--interruption)"></i>净打断</span>
      <span><i style="background:repeating-linear-gradient(45deg,var(--interruption),var(--interruption) 3px,transparent 3px,transparent 6px)"></i>净打断总览</span>
      <span><i style="background:var(--warning)"></i>冲突 / 恢复点</span>
      <span><i style="background:var(--frontier);height:3px"></i>当前时刻</span>`;
  }

  function stageTip(r) {
    return `第 ${r.order} 阶段「${r.name}」（${statusLabel(r.status)}）\n` +
      `占用窗 ${fmtClock(r.windowStart)}–${fmtClock(r.windowEnd)}\n` +
      `预算 ${fmtN(r.budgetMinutes)} 分｜已计入 ${fmtN(r.countedMinutes)}｜剩余 ${fmtN(r.remainingMinutes)}\n` +
      `窗内打断 ${fmtN(r.interruptionInWindow)} 分`;
  }
  function cutTip(c) {
    return `净打断片段 ${fmtClock(c.start)}–${fmtClock(c.end)}（${fmtN(c.duration)} 分）\n来源：` +
      c.members.map((m) => `${m.source}·${m.reason}`).join('、');
  }
  function makeTicks(maxT) {
    const raw = [5, 10, 15, 20, 30, 60, 120, 240, 480];
    const step = raw.find((s) => maxT / s <= 10) || 600;
    const ticks = [];
    for (let t = 0; t <= maxT + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  // ---------------- 通知 ----------------
  function pushNotice(kind, html) { notices.push({ kind, html }); renderNotices(); }
  function renderNotices() {
    const box = document.getElementById('noticeBox');
    box.innerHTML = notices.map((n, i) =>
      `<div class="notice notice-${n.kind}"><button class="notice-dismiss" data-act="dismiss-notice" data-i="${i}">×</button>${n.html}</div>`
    ).join('');
  }

  // ---------------- 事件 ----------------
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'dismiss-notice') { notices.splice(Number(btn.dataset.i), 1); renderNotices(); return; }

    if (act === 'resolve') {
      const r = C.resolveSource(state.session, btn.dataset.int, btn.dataset.src, btn.dataset.res);
      finishMutation(r, `已将来源记录标记为「${resolutionLabel(btn.dataset.res)}」`);
    }
    if (act === 'res-select') return; // change 事件处理
    if (act === 'del-stage') {
      const tr = btn.closest('tr'); const id = tr.dataset.stage;
      state.session.stages = state.session.stages.filter((s) => s.id !== id);
      render();
    }
    if (act === 'del-int') {
      state.session.interruptions = state.session.interruptions.filter((i) => i.id !== btn.dataset.int);
      render();
    }
    if (act === 'del-src') {
      const it = state.session.interruptions.find((x) => x.id === btn.dataset.int);
      if (it) it.sources = it.sources.filter((s) => s.id !== btn.dataset.src);
      render();
    }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.matches('[data-act="res-select"]')) {
      const r = C.resolveSource(state.session, el.dataset.int, el.dataset.src, el.value);
      finishMutation(r, `消解结论已更新为「${resolutionLabel(el.value)}」，净打断与全部阶段已立即重推。`);
    }
    const stageRow = el.closest('#stageEditTable tbody tr');
    if (stageRow) {
      const s = state.session.stages.find((x) => x.id === stageRow.dataset.stage);
      if (!s) return;
      const f = el.dataset.f;
      if (f === 'order' || f === 'budget') {
        const v = Number(el.value);
        if (!Number.isFinite(v)) return;
        s[f] = v;
      } else s[f] = el.value;
      render();
    }
  });

  document.getElementById('stageForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const order = parseInt(f.order.value, 10);
    const budget = Number(f.budget.value);
    const name = f.name.value.trim() || `阶段 ${order}`;
    const draft = C.makeStage({ id: uid('stg'), name, budgetMinutes: budget, order, status: f.status.value });
    const v = C.validateStages([...state.session.stages, draft]);
    if (!v.ok) {
      document.getElementById('stageErrorBox').innerHTML = v.errors.map((e) => `<div class="field-error">⛔ ${esc(e.message)}</div>`).join('');
      return;
    }
    state.session.stages.push(draft);
    f.reset();
    render();
    pushNotice('info', `已添加阶段「${esc(name)}」（顺序 ${order}，预算 ${budget} 分钟）。`);
  });

  document.getElementById('reportForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const start = parseTime(f.start.value);
    const end = parseTime(f.end.value);
    const source = f.source.value.trim();
    let interruptionId = f.interruptionSel.value;
    let reason = f.reason.value.trim();
    if (interruptionId === '__new__') {
      interruptionId = f.newId.value.trim() || uid('int');
    } else {
      reason = reason || state.session.interruptions.find((x) => x.id === interruptionId)?.reason || '';
    }
    const before = C.derive(state.session).schedule;
    const r = C.addSourceReport(state.session, { interruptionId, reason: reason || '未说明原因', source, start, end, resolution: f.resolution.value });
    if (!r.ok) {
      document.getElementById('reportErrorBox').innerHTML = r.errors.map((e) => `<div class="field-error">⛔ ${esc(e.message)}</div>`).join('');
      return;
    }
    state.session = r.session;
    render();

    // 裁剪说明 + 双重计扣减台账
    for (const t of r.truncations) {
      const which = t.kind === 'before-start' ? '早于会话起点（t=0）' : '超出当前会话末端';
      pushNotice('warn', `✂ <b>越界裁剪：</b>来源「${esc(t.source)}」原报区间 ${fmtClock(t.original.start)}–${fmtClock(t.original.end)} ${which}，` +
        `已裁为 ${fmtClock(t.clipped.start)}–${fmtClock(t.clipped.end)}，丢弃 <b>${fmtN(t.droppedMinutes)}</b> 分钟。`);
    }
    if (before) {
      const after = C.derive(state.session).schedule;
      const audit = C.diffSchedules(before, after);
      for (const d of audit.doubleCountDeductions) {
        pushNotice('deduct', `🧾 <b>扣减重复计入：</b>${esc(d.message)}。扣减来源台账：` +
          `<ul>${d.sources.map((s2) => `<li>${esc(s2.source)}（打断「${esc(s2.reason)}」）交叠 ${fmtClock(s2.interval.start)}–${fmtClock(s2.interval.end)}</li>`).join('')}</ul>`);
      }
      if (f.resolution.value === C.RESOLUTION.CONFIRMED && audit.changedStages.length) {
        pushNotice('info', `🔁 已重推 ${audit.changedStages.length} 个受影响阶段（${audit.changedStages.map((c) => `「${esc(c.name)}」`).join('、')}）` +
          (audit.unchangedStages.length ? `；未受影响阶段 ${audit.unchangedStages.length} 个保持不变。` : '。'));
      }
    }
    f.start.value = f.end.value = f.reason.value = f.source.value = f.newId.value = '';
  });

  document.getElementById('nowSetBtn').addEventListener('click', () => {
    const v = parseTime(document.getElementById('nowInput').value);
    if (!Number.isFinite(v) || v < 0) { pushNotice('error', '当前时刻格式无效，请输入 HH:MM（如 01:30）或非负分钟数。'); return; }
    state.session.nowMinutes = v;
    render();
    pushNotice('info', `已设定当前时刻为 ${fmtClock(v)}，计入时长与恢复位置已重算。`);
  });
  document.getElementById('nowClearBtn').addEventListener('click', () => {
    state.session.nowMinutes = null;
    render();
  });
  document.getElementById('sampleBtn').addEventListener('click', () => {
    state = { session: buildSampleSession(), idCounter: 200 };
    notices = [];
    render();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('确定清空全部阶段与打断记录？此操作不可撤销。')) return;
    state = { session: C.createSession({ nowMinutes: null, stages: [], interruptions: [] }), idCounter: 1 };
    notices = [];
    render();
  });

  function finishMutation(r, okMsg) {
    if (!r.ok) { pushNotice('error', r.errors.map((e) => esc(e.message)).join('；')); return; }
    state.session = r.session;
    render();
    pushNotice('info', esc(okMsg));
  }

  // ---------------- tooltip ----------------
  const tip = document.getElementById('tooltip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip.replaceAll('&#10;', '\n');
    tip.hidden = false;
    tip.style.whiteSpace = tip.textContent.includes('\n') ? 'pre-line' : 'normal';
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 12)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) tip.hidden = true; });

  window.addEventListener('resize', () => renderTimeline(C.derive(state.session)));

  // ---------------- 启动即进入可用界面 ----------------
  render();
})();
