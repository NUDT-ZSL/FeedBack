/**
 * app.js — 界面编排。所有数据操作只经内核入口；每次变更后持久化并重渲染，
 * 比较结果的稳定性由内核签名缓存保证，界面不做任何本地插补。
 */
(function () {
  'use strict';

  var RC = window.RetentionCore;
  var Store = window.Store;

  var selA = 'organic-0601';
  var selB = 'paid-0615';
  var THEME_KEY = 'retention-workbench-theme';

  // ---------- 小工具 ----------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function pp(x) { return (x > 0 ? '+' : '') + (x * 100).toFixed(1) + 'pp'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fmtDate(iso) {
    try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return iso; }
  }

  function S() { return Store.state(); }

  // ---------- 启动 ----------

  function init() {
    var boot = Store.init();
    initTheme();
    bindChrome();
    bindForms();
    // 若默认选择在导入数据后不存在，退化为前两个同分层队列
    ensureSelection();
    render();
    if (boot.errors && boot.errors.length) {
      toast('存档中有 ' + boot.errors.length + ' 条记录未通过校验，已跳过', true);
    }
  }

  function ensureSelection() {
    var ids = S().cohorts.map(function (c) { return c.id; });
    if (ids.indexOf(selA) >= 0 && ids.indexOf(selB) >= 0 && selA !== selB) return;
    // 优先选第一个“可比”分层里的前两个含观测队列
    var pick = null;
    RC.strataSummary(S()).some(function (z) {
      if (z.comparable && z.cohorts.length >= 2) { pick = [z.cohorts[0].id, z.cohorts[1].id]; return true; }
      return false;
    });
    if (!pick && ids.length >= 2) pick = [ids[0], ids[1]];
    else if (!pick) pick = [ids[0] || '', ''];
    selA = pick[0];
    selB = pick[1];
  }

  // ---------- 主题 ----------

  function initTheme() {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    var param = new URLSearchParams(location.search).get('theme');
    if (param === 'dark' || param === 'light') t = param;
    if (t) document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      render(); // 图表颜色取自 CSS 变量，需重绘
    });
  }

  // ---------- 顶栏操作 ----------

  function bindChrome() {
    $('#cmpA').addEventListener('change', function (e) { selA = e.target.value; render(); });
    $('#cmpB').addEventListener('change', function (e) { selB = e.target.value; render(); });
    $('#swapBtn').addEventListener('click', function () { var t = selA; selA = selB; selB = t; render(); });
    $('#minCohorts').addEventListener('change', function (e) {
      var n = parseInt(e.target.value, 10);
      var r = RC.setMinCohortsPerStratum(S(), n);
      if (!r.ok) { toast(r.message, true); }
      Store.persist();
      render();
    });

    $('#resetBtn').addEventListener('click', function () {
      if (!window.confirm('重置为内置演示数据？当前本地数据将被覆盖。')) return;
      Store.resetSeed();
      selA = 'organic-0601'; selB = 'paid-0615';
      render();
      toast('已恢复演示数据');
    });

    $('#exportBtn').addEventListener('click', function () {
      var blob = new Blob([Store.exportJson()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'retention-cohorts.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    $('#importFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var r = Store.importJson(String(reader.result));
        if (!r.ok) { toast(r.message, true); }
        else {
          ensureSelection();
          render();
          toast('导入完成' + (r.errors.length ? '，' + r.errors.length + ' 条记录未通过校验已跳过' : ''));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  // ---------- 表单 ----------

  function bindForms() {
    $('#formCohort').addEventListener('submit', function (e) {
      e.preventDefault();
      clearInvalid(this);
      var r = RC.addCohort(S(), {
        name: $('#fName', this).value.trim(),
        channel: $('#fChannel', this).value.trim(),
        stratum: $('#fStratum', this).value.trim(),
        size: parseInt($('#fSize', this).value, 10),
        startAt: $('#fStart', this).value,
        note: $('#fNote', this).value.trim(),
      });
      if (!r.ok) { formMsg(this, false, r.message, r.location); markField(this, r.field); return; }
      this.reset();
      Store.persist();
      selB = r.cohortId; // 直接把新队列放进比较位，立即可见
      ensureSelection();
      render();
      formMsg(this, true, '已新建队列「' + r.cohort.name + '」，规模 ' + r.cohort.size + '，起始 ' + fmtDate(r.cohort.startAt));
    });

    $('#formObs').addEventListener('submit', function (e) {
      e.preventDefault();
      clearInvalid(this);
      var id = $('#fObsCohort', this).value;
      var r = RC.addObservation(S(), id, {
        period: parseInt($('#fPeriod', this).value, 10),
        active: parseInt($('#fActive', this).value, 10),
        source: $('#fSource', this).value.trim() || '手工录入',
      });
      if (!r.ok) { formMsg(this, false, r.message, r.location); markField(this, r.field); return; }
      this.reset();
      Store.persist();
      render();
      if (r.status === 'duplicate') formMsg(this, true, '幂等：' + r.message);
      else if (r.status === 'conflict') formMsg(this, false, r.message);
      else formMsg(this, true, '第 ' + r.period + ' 期观测已写入，矩阵与比较结果已即时刷新');
    });

    $('#formScale').addEventListener('submit', function (e) {
      e.preventDefault();
      clearInvalid(this);
      var id = $('#fScaleCohort', this).value;
      var r = RC.correctScale(S(), id, parseInt($('#fNewSize', this).value, 10), $('#fScaleReason', this).value.trim());
      if (!r.ok) { formMsg(this, false, r.message, (r.locations || []).join('；')); return; }
      this.reset();
      Store.persist();
      render();
      formMsg(this, true, r.status === 'duplicate' ? r.message : ('规模已由 ' + r.from + ' 修正为 ' + r.to + '，受影响比较已重算（与全量重算一致），未涉及的比较保持不变'));
    });
  }

  function formMsg(form, ok, msg, loc) {
    var box = $('.form-msg', form);
    box.className = 'form-msg show ' + (ok ? 'ok' : 'err');
    box.textContent = msg || '';
    if (loc) {
      var span = document.createElement('span');
      span.className = 'loc';
      span.textContent = '位置：' + loc;
      box.appendChild(span);
    }
  }
  function markField(form, field) {
    if (!field) return;
    var map = { size: 'fSize', startAt: 'fStart', period: 'fPeriod', active: 'fActive' };
    var id = map[field];
    if (id && $('#' + id, form)) $('#' + id, form).classList.add('invalid');
  }
  function clearInvalid(form) {
    $all('.invalid', form).forEach(function (n) { n.classList.remove('invalid'); });
    var box = $('.form-msg', form);
    if (box) box.className = 'form-msg';
  }

  // ---------- 总渲染 ----------

  function render() {
    renderSelectors();
    renderStrata();
    renderComparison();
    renderMatrix();
    renderConflicts();
  }

  // ---------- 队列选择器 ----------

  function cohortOptions() {
    var byStratum = new Map();
    S().cohorts.forEach(function (c) {
      if (!byStratum.has(c.stratum)) byStratum.set(c.stratum, []);
      byStratum.get(c.stratum).push(c);
    });
    var html = '';
    Array.from(byStratum.keys()).sort().forEach(function (st) {
      html += '<optgroup label="' + esc(st) + '">';
      byStratum.get(st).forEach(function (c) {
        var n = RC.maxObservedPeriod(c);
        html += '<option value="' + esc(c.id) + '">' + esc(c.name) +
          '（' + esc(c.channel) + '，' + c.size + '人，观测至第' + (n < 0 ? '—' : n) + '期）</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  function renderSelectors() {
    var opts = cohortOptions();
    var a = $('#cmpA'), b = $('#cmpB');
    a.innerHTML = opts;
    b.innerHTML = opts;
    a.value = selA;
    b.value = selB;
    $('#minCohorts').value = String(S().minCohortsPerStratum);
    // 表单里的队列下拉
    ['fObsCohort', 'fScaleCohort'].forEach(function (id) {
      var node = $('#' + id);
      var cur = node.value;
      node.innerHTML = opts;
      if (cur) node.value = cur;
    });
  }

  // ---------- 分层概览 ----------

  function renderStrata() {
    var mount = $('#strataCards');
    var data = RC.strataSummary(S());
    if (!data.length) { mount.innerHTML = '<div class="empty">还没有队列，用下方表单新建第一个。</div>'; return; }
    mount.innerHTML = data.map(function (z) {
      var status = z.comparable
        ? '<span class="tag ok">✓ 可比 · ' + z.usableCount + ' 个（下限 ' + z.required + '）</span>'
        : '<span class="tag no">✕ 不可比 · 缺 ' + z.missing + ' 个</span>';
      var pending = z.pendingConflicts ? '<span class="tag warn">⚠ ' + z.pendingConflicts + ' 个待裁决</span>' : '';
      var chips = z.cohorts.map(function (c) {
        var n = RC.observedPeriods(c).length;
        return '<span class="chip">' + esc(c.name) + (n ? '（' + n + '期）' : '（无观测）') + '</span>';
      }).join('');
      return '<div class="stratum-card ' + (z.comparable ? 'comparable' : 'not-comparable') + '">' +
        '<div class="head"><span class="name">' + esc(z.stratum) + '</span> ' + status + '</div>' +
        '<div class="meta">含观测队列 <b>' + z.usableCount + '</b> / 共 ' + z.count + ' 个 · 下限 ' + z.required + ' ' + pending + '</div>' +
        '<p class="explain">' + esc(z.note) + '</p>' +
        '<div class="chips">' + chips + '</div></div>';
    }).join('');
  }

  // ---------- 比较面板 ----------

  function renderComparison() {
    var mount = $('#comparePanel');
    if (!selA || !selB) {
      mount.innerHTML = '<div class="empty">请在上方选择两个队列。</div>';
      return;
    }
    var r = RC.compareCohorts(S(), selA, selB);
    if (!r.ok && r.code !== 'NO_COMMON_WINDOW') {
      mount.innerHTML = '<div class="alert bad"><span class="ico">✕</span><div>' + esc(r.message) + '</div></div>';
      return;
    }

    var a = r.cohortA, b = r.cohortB;
    var html = '';
    html += '<div class="cmp-head">' +
      '<span><span class="swatch a"></span> <span class="who a">A：' + esc(a.name) + '</span> <span class="kv">[' + esc(a.stratum) + ' · ' + esc(a.channel) + ' · 规模 ' + a.size + ' · 起跑 ' + fmtDate(a.startAt) + ']</span></span>' +
      '<span class="muted">vs</span>' +
      '<span><span class="swatch b"></span> <span class="who b">B：' + esc(b.name) + '</span> <span class="kv">[' + esc(b.stratum) + ' · ' + esc(b.channel) + ' · 规模 ' + b.size + ' · 起跑 ' + fmtDate(b.startAt) + ']</span></span>';

    if (r.sameStratum === false) {
      html += '<span class="tag warn">跨分层比较：仅供查看，不得据此判断分层优劣</span>';
    }
    html += '</div>';

    if (r.code === 'NO_COMMON_WINDOW') {
      html += '<div class="alert bad"><span class="ico">✕</span><div><strong>不存在共同观察窗口。</strong>' + esc(r.message) + '</div></div>';
      html += exclusionsHtml(r.exclusions);
      mount.innerHTML = html;
      return;
    }

    html += '<div style="margin:4px 0"><span class="window-pill">共同观察窗口：第 ' + r.window.start + '–' + r.window.end + ' 期，共 ' + r.window.length + ' 期对齐</span>' +
      '<span class="kv" style="margin-left:10px">窗口内均值 A ' + pct(r.summary.meanRateA) + ' · B ' + pct(r.summary.meanRateB) + ' · 均值差 ' + pp(r.summary.meanDiff) + '</span></div>';

    if (r.hasReversal) {
      var tags = r.reversals.map(function (v) {
        return '<span>第' + v.period + '期 ' + (v.from === 'A' ? 'A→B' : 'B→A') + '</span>';
      }).join('');
      html += '<div class="alert cross"><span class="ico">⇄</span><div><strong>窗口内优势方向发生 ' + r.reversals.length + ' 次反转：</strong>' +
        '<span class="period-tags">' + tags + '</span><div class="small muted" style="margin-top:3px">出现反转意味着单看均值或末期会误判渠道优劣，请逐期查看下表。</div></div></div>';
    } else {
      html += '<div class="alert info"><span class="ico">＝</span><div>窗口内优势方向<strong>未反转</strong>，' +
        'A 领先 ' + r.summary.aLeads + ' 期 / B 领先 ' + r.summary.bLeads + ' 期 / 持平 ' + r.summary.ties + ' 期。</div></div>';
    }

    html += '<div class="legend">' +
      '<span class="item a"><span class="key"></span>' + esc(a.name) + '</span>' +
      '<span class="item b"><span class="key"></span>' + esc(b.name) + '</span>' +
      '<span class="item"><span class="key ghost"></span>窗口外真实观测（已排除，非 0）</span>' +
      '<span class="item"><span class="key window"></span>共同窗口</span>' +
      '<span class="item">◇ 未裁决冲突候选值</span></div>';
    html += '<div class="chart-wrap" id="chartMount"></div>';

    html += periodTableHtml(r);
    html += exclusionsHtml(r.exclusions);

    mount.innerHTML = html;
    window.Charts.compareChart($('#chartMount'), r);
  }

  function periodTableHtml(r) {
    var a = r.cohortA, b = r.cohortB;
    var maxAbs = Math.max.apply(null, r.rows.map(function (x) { return Math.abs(x.diff); }).concat([0.01]));
    var rows = r.rows.map(function (x) {
      var w = Math.round((Math.abs(x.diff) / maxAbs) * 50);
      var rev = r.reversals.some(function (v) { return v.period === x.period; });
      var dirText = x.direction === 'tie' ? '持平' : x.direction === 'A' ? 'A 领先' : 'B 领先';
      var bar = x.diff === 0 ? '' :
        '<span class="diff-track"><span class="diff-fill ' + x.direction + '" style="width:' + w + '%"></span></span>';
      return '<tr>' +
        '<td class="num">第 ' + x.period + ' 期</td>' +
        '<td class="num">' + pct(x.rateA) + ' <span class="muted small">(' + x.activeA + '/' + a.size + ')</span></td>' +
        '<td class="num">' + pct(x.rateB) + ' <span class="muted small">(' + x.activeB + '/' + b.size + ')</span></td>' +
        '<td class="num diff-bar-cell">' + bar + '<span class="dir-dot ' + x.direction + '"></span>' + pp(x.diff) + '</td>' +
        '<td>' + esc(dirText) + (rev ? ' <span class="rev-cell">⇄ 反转点</span>' : '') + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table><thead><tr>' +
      '<th>共同观察期</th><th class="num">A 留存率</th><th class="num">B 留存率</th><th class="num">差额（A−B）</th><th>方向</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  var EXCL_LABEL = {
    BEFORE_WINDOW: '早于窗口',
    AFTER_WINDOW: '超出窗口',
    GAP_IN_WINDOW: '窗口缺口',
    UNRESOLVED_CONFLICT: '冲突未决',
    OUTSIDE_WINDOW: '无共窗口',
  };

  function exclusionsHtml(list) {
    if (!list.length) {
      return '<details class="small" style="margin-top:8px"><summary class="muted">被排除的观测：无（窗口内无缺口、无待裁决冲突）</summary></details>';
    }
    var items = list.map(function (e) {
      return '<li><span class="code">' + (EXCL_LABEL[e.reasonCode] || e.reasonCode) + '</span>' +
        '<span class="who">' + esc(e.cohortName) + ' · 第' + e.period + '期</span>' +
        '<span class="reason">' + esc(e.reason) + '</span></li>';
    }).join('');
    return '<details class="small" style="margin-top:10px" open><summary class="muted" style="cursor:pointer">被排除的观测（' + list.length + ' 条，逐条说明原因；一律不作 0/缺失填补）</summary>' +
      '<ul class="excl-list">' + items + '</ul></details>';
  }

  // ---------- 留存矩阵 ----------

  function renderMatrix() {
    var mount = $('#matrixPanel');
    var m = RC.retentionMatrix(S());
    if (!m.periods.length) { mount.innerHTML = '<div class="empty">尚无任何观测。</div>'; return; }
    var head = '<tr><th class="rowhead">队列 ＼ 观察期</th>' +
      m.periods.map(function (p) { return '<th>第' + p + '期</th>'; }).join('') + '</tr>';
    var body = m.rows.map(function (row) {
      var c = row.cohort;
      var cells = row.cells.map(function (cell) {
        if (cell.state === 'unobserved') return '<td><div class="cell unobserved" title="未观测（不是 0 留存）">—</div></td>';
        if (cell.state === 'conflicted') {
          var vals = cell.conflict.values.map(function (v) { return v.active + '（' + v.source + '）'; }).join(' vs ');
          return '<td><div class="cell conflicted" title="数值冲突待裁决：' + esc(vals) + '"><span class="confico">⚠</span></div></td>';
        }
        var bin = Math.min(4, Math.floor(cell.rate * 5));
        var title = c.name + ' 第' + cell.period + '期：' + pct(cell.rate) + '（' + cell.active + '/' + c.size + '）' +
          (cell.state === 'resolved-conflict' ? '，冲突已按裁决值计算' : '');
        return '<td><div class="cell h' + bin + '" title="' + esc(title) + '">' + Math.round(cell.rate * 100) + '%</div></td>';
      }).join('');
      return '<tr><th class="rowhead">' + esc(c.name) + '<span class="rowmeta">' + esc(c.stratum) + ' · ' + esc(c.channel) + ' · n=' + c.size + '</span></th>' + cells + '</tr>';
    }).join('');
    mount.innerHTML = '<div class="matrix-scroll"><table class="matrix">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="small muted" style="margin:8px 0 0">蓝色越深留存越高；“—”是从未观测（虚线格），与观测到 0% 完全不同；⚠ 是多来源数值冲突待裁决，裁决前不参与任何比较。</p>';
  }

  // ---------- 冲突面板 ----------

  function renderConflicts() {
    var mount = $('#conflictPanel');
    var all = [];
    S().cohorts.forEach(function (c) {
      c.conflicts.forEach(function (cf) { all.push({ c: c, cf: cf }); });
    });
    all.sort(function (x, y) {
      if (x.cf.status !== y.cf.status) return x.cf.status === 'pending' ? -1 : 1;
      return x.c.name.localeCompare(y.c.name) || x.cf.period - y.cf.period;
    });
    if (!all.length) {
      mount.innerHTML = '<div class="empty">当前没有数值冲突。同期收到不同活跃数时，双方来源与数值会在此并列保留。</div>';
      return;
    }
    mount.innerHTML = all.map(function (item) {
      var c = item.c, cf = item.cf;
      var cands = cf.values.map(function (v) {
        var picked = cf.status === 'resolved' && cf.resolvedValue && cf.resolvedValue.active === v.active && cf.resolvedValue.source === v.source;
        return '<button class="cand-btn" data-cohort="' + esc(c.id) + '" data-key="' + esc(cf.key) + '" data-active="' + v.active + '" data-source="' + esc(v.source) + '"' +
          (cf.status !== 'pending' ? ' disabled' : '') + '>' +
          '<b>' + v.active + '</b><span class="small muted">' + esc(v.source) + (picked ? ' ✓ 已采纳' : '') + '</span></button>';
      }).join('');
      var foot = cf.status === 'pending'
        ? '<div class="cust-resolve"><input type="number" min="0" max="' + c.size + '" placeholder="其他值" class="custom-val">' +
          '<input type="text" placeholder="来源/口径" class="custom-src" style="width:130px">' +
          '<button class="custom-ok" data-cohort="' + esc(c.id) + '" data-key="' + esc(cf.key) + '">按自定义值裁决</button></div>'
        : '<p class="small muted" style="margin:6px 0 0">已裁决：采纳 ' + cf.resolvedValue.active + '（' + esc(cf.resolvedValue.source) +
          (cf.resolvedValue.reason ? '；' + esc(cf.resolvedValue.reason) : '') + '），冲突记录永久保留。</p>';
      return '<div class="conflict-card ' + (cf.status === 'pending' ? '' : 'resolved') + '">' +
        '<div class="ctitle">' + (cf.status === 'pending' ? '⚠ 待裁决冲突' : '✓ 已裁决冲突') + '：' + esc(c.name) + ' · 第 ' + cf.period + ' 期</div>' +
        '<div class="small muted">规模 ' + c.size + ' · 以下来源给出了互相矛盾的活跃数，系统未静默择一：</div>' +
        '<div class="cands">' + cands + '</div>' + foot + '</div>';
    }).join('');

    $all('.cand-btn', mount).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = RC.resolveConflict(S(), btn.dataset.key, { active: Number(btn.dataset.active), source: btn.dataset.source });
        finishResolve(r);
      });
    });
    $all('.custom-ok', mount).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.conflict-card');
        var val = parseInt($('.custom-val', card).value, 10);
        var src = $('.custom-src', card).value.trim() || '人工裁决';
        var r = RC.resolveConflict(S(), btn.dataset.key, { active: val, source: src, reason: '自定义口径录入' });
        finishResolve(r);
      });
    });
  }

  function finishResolve(r) {
    if (!r.ok) { toast(r.message, true); return; }
    Store.persist();
    render();
    toast('冲突已裁决（采纳 ' + r.resolution.active + '，来源 ' + r.resolution.source + '），共同窗口已据此更新');
  }

  // ---------- toast ----------

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3600);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
