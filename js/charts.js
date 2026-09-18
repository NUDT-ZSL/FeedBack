/**
 * charts.js — 无依赖 SVG 图表。
 *  compareChart：共同窗口双线留存曲线；窗口外观测以灰色幽灵点显式画出（看得到、但标明已排除）；
 *                未裁决冲突期以空心菱形展示双方候选值；十字线 + 单 tooltip 读全部系列。
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var VB_W = 720;
  var VB_H = 300;
  var M = { top: 18, right: 78, bottom: 38, left: 48 };

  function el(tag, attrs, children) {
    var node = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function pct(x) {
    return (x * 100).toFixed(1) + '%';
  }

  /**
   * @param mount  容器 DOM
   * @param result RC.compareCohorts 的结果（ok=true）
   */
  function compareChart(mount, result) {
    mount.textContent = '';
    var a = result.cohortA;
    var b = result.cohortB;
    var win = result.window;

    // X 域：双方所有出现过的观察期（含冲突候选期、窗口外），让“被排除的真实观测”可见
    var allPeriods = new Set();
    a.obs.forEach(function (o) { allPeriods.add(o.period); });
    b.obs.forEach(function (o) { allPeriods.add(o.period); });
    var xs = Array.from(allPeriods).sort(function (x, y) { return x - y; });
    var xMin = xs[0];
    var xMax = xs[xs.length - 1];

    var plotW = VB_W - M.left - M.right;
    var plotH = VB_H - M.top - M.bottom;

    function xPos(p) {
      if (xMax === xMin) return M.left + plotW / 2;
      return M.left + ((p - xMin) / (xMax - xMin)) * plotW;
    }
    function yPos(rate) {
      return M.top + (1 - rate) * plotH;
    }

    var svg = el('svg', { viewBox: '0 0 ' + VB_W + ' ' + VB_H, role: 'img', 'aria-label': '共同观察窗口内的两队列留存曲线' });
    var cssVar = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };
    var C = {
      s1: cssVar('--s1') || '#2a78d6',
      s2: cssVar('--s2') || '#eb6834',
      muted: cssVar('--muted') || '#898781',
      grid: cssVar('--grid') || '#e1e0d9',
      axis: cssVar('--axis') || '#c3c2b7',
      surface: cssVar('--surface') || '#fcfcfb',
      warning: cssVar('--warning') || '#fab219',
      tint: cssVar('--window-tint') || 'rgba(42,120,214,0.08)',
    };

    // ---- 网格与 Y 轴（0–100%）----
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var y = yPos(t);
      svg.appendChild(el('line', { x1: M.left, x2: VB_W - M.right, y1: y, y2: y, class: 'svg-grid' }));
      svg.appendChild(el('text', { x: M.left - 8, y: y + 4, 'text-anchor': 'end', class: 'svg-muted', text: Math.round(t * 100) + '%' }));
    });

    // ---- X 轴刻度（每个观察期）----
    xs.forEach(function (p) {
      svg.appendChild(el('line', { x1: xPos(p), x2: xPos(p), y1: M.top + plotH, y2: M.top + plotH + 5, class: 'svg-axis' }));
      svg.appendChild(el('text', { x: xPos(p), y: M.top + plotH + 20, 'text-anchor': 'middle', class: 'svg-muted', text: '第' + p + '期' }));
    });

    // ---- 共同窗口底色（跨整格）----
    var bandX1 = xPos(win.start) - stepWidth() / 2;
    var bandX2 = xPos(win.end) + stepWidth() / 2;
    svg.appendChild(el('rect', {
      x: Math.max(M.left, bandX1), y: M.top,
      width: Math.min(VB_W - M.right, bandX2) - Math.max(M.left, bandX1),
      height: plotH, fill: C.tint, rx: 4,
    }));
    svg.appendChild(el('text', {
      x: Math.max(M.left, bandX1) + 8, y: M.top + 14, class: 'svg-ink2',
      text: '共同观察窗口 · 第' + win.start + '–' + win.end + '期（仅此处计入比较）',
    }));
    svg.appendChild(el('line', { x1: M.left, x2: VB_W - M.right, y1: M.top + plotH, y2: M.top + plotH, class: 'svg-axis' }));

    function stepWidth() {
      return xMax > xMin ? plotW / (xMax - xMin) : plotW;
    }

    // ---- 窗口内曲线：连续期成段，缺口/冲突处断开（不插补）----
    var rowsByPeriod = new Map();
    result.rows.forEach(function (r) { rowsByPeriod.set(r.period, r); });
    var inWindow = new Set(win.periods);

    var segments = [];
    var cur = [];
    win.periods.forEach(function (p) {
      if (cur.length && p !== cur[cur.length - 1] + 1) { segments.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segments.push(cur);

    function drawWindowLine(which, color) {
      segments.forEach(function (seg) {
        var d = seg.map(function (p, i) {
          var r = rowsByPeriod.get(p);
          return (i === 0 ? 'M' : 'L') + xPos(p).toFixed(1) + ' ' + yPos(which === 'A' ? r.rateA : r.rateB).toFixed(1);
        }).join(' ');
        svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      });
      win.periods.forEach(function (p) {
        var r = rowsByPeriod.get(p);
        var rate = which === 'A' ? r.rateA : r.rateB;
        // 8px 标记 + 2px 表面环
        svg.appendChild(el('circle', { cx: xPos(p), cy: yPos(rate), r: 5.5, fill: C.surface, opacity: 1 }));
        svg.appendChild(el('circle', { cx: xPos(p), cy: yPos(rate), r: 4, fill: color }));
      });
    }

    // 末端直接标注：紧跟最后一个窗口点；两端过近（<8pp）时放弃，交给图例/表格/tooltip，
    // 避免标注相互重叠或与窗口外幽灵点同列造成“该队列窗口外也有数据”的误读。
    var lastP = win.periods[win.periods.length - 1];
    var lastR = rowsByPeriod.get(lastP);
    var endYA = yPos(lastR.rateA);
    var endYB = yPos(lastR.rateB);
    var labelX = xPos(lastP) + 10;
    if (Math.abs(endYA - endYB) >= 18) {
      addEndLabel('A', endYA, lastR.rateA, C.s1);
      addEndLabel('B', endYB, lastR.rateB, C.s2);
    }

    function addEndLabel(which, y, rate, color) {
      var g = el('g', {});
      g.appendChild(el('circle', { cx: labelX, cy: y, r: 4, fill: color }));
      g.appendChild(el('text', { x: labelX + 8, y: y + 4, class: 'svg-endlabel', fill: cssVar('--ink-2'), text: pct(rate) }));
      svg.appendChild(g);
    }

    // ---- 窗口外观测：灰色幽灵点（真实数据，但明确不计入比较）----
    function drawGhosts(cohort, which) {
      var exclByPeriod = new Map();
      result.exclusions.forEach(function (e) {
        if (e.cohortId === cohort.id && (e.reasonCode === 'AFTER_WINDOW' || e.reasonCode === 'BEFORE_WINDOW')) {
          exclByPeriod.set(e.period, e);
        }
      });
      var sorted = Array.from(exclByPeriod.keys()).sort(function (x, y) { return x - y; });
      // 幽灵点之间用点线相连（同队列真实轨迹），但与窗口曲线断开
      if (sorted.length > 1) {
        var d = sorted.map(function (p, i) {
          var act = cohort.obs.filter(function (o) { return o.period === p; })[0].active;
          return (i === 0 ? 'M' : 'L') + xPos(p).toFixed(1) + ' ' + yPos(act / cohort.size).toFixed(1);
        }).join(' ');
        svg.appendChild(el('path', { d: d, fill: 'none', stroke: C.muted, 'stroke-width': 1.5, 'stroke-dasharray': '2 4', 'stroke-linecap': 'round' }));
      }
      sorted.forEach(function (p) {
        var act = cohort.obs.filter(function (o) { return o.period === p; })[0].active;
        svg.appendChild(el('circle', { cx: xPos(p), cy: yPos(act / cohort.size), r: 3.5, fill: C.surface, stroke: C.muted, 'stroke-width': 1.5 }));
      });
    }

    // ---- 未裁决冲突：双方候选值空心菱形 ----
    function drawConflicts(cohort) {
      cohort.conflicts.filter(function (c) { return c.status === 'pending'; }).forEach(function (c) {
        c.values.forEach(function (v) {
          var cx = xPos(c.period), cy = yPos(v.active / cohort.size), s = 5;
          var d = 'M' + cx + ' ' + (cy - s) + 'L' + (cx + s) + ' ' + cy + 'L' + cx + ' ' + (cy + s) + 'L' + (cx - s) + ' ' + cy + 'Z';
          svg.appendChild(el('path', { d: d, fill: C.surface, stroke: C.warning, 'stroke-width': 1.8 }));
        });
      });
    }

    drawGhosts(a, 'A');
    drawGhosts(b, 'B');
    drawConflicts(a);
    drawConflicts(b);
    drawWindowLine('A', C.s1);
    drawWindowLine('B', C.s2);

    // ---- 十字线 + 命中层 ----
    var crosshair = el('line', { y1: M.top, y2: M.top + plotH, stroke: C.axis, 'stroke-width': 1, opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(crosshair);

    var hit = el('rect', { x: M.left, y: M.top, width: plotW, height: plotH, fill: 'transparent' });
    svg.appendChild(hit);

    var tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    mount.appendChild(svg);
    mount.appendChild(tip);

    function nearestPeriod(clientX) {
      var rect = svg.getBoundingClientRect();
      var vbX = ((clientX - rect.left) / rect.width) * VB_W;
      var best = xs[0], bd = Infinity;
      xs.forEach(function (p) {
        var d = Math.abs(xPos(p) - vbX);
        if (d < bd) { bd = d; best = p; }
      });
      return best;
    }

    function showTip(clientX, clientY, p) {
      var inWin = inWindow.has(p) && rowsByPeriod.has(p);
      var parts = ['<div class="tt-title">第' + p + '期</div>'];

      function seriesLine(cohort, which, color) {
        var rows = cohort.obs.filter(function (o) { return o.period === p; });
        var conflict = cohort.conflicts.find(function (c) { return c.period === p; });
        var dot = '<span class="stroke" style="background:' + color + '"></span>';
        if (conflict && conflict.status === 'pending') {
          var cands = conflict.values.map(function (v) { return v.active + '（' + escapeHtml(v.source) + '）'; }).join(' vs ');
          parts.push('<div class="tt-row ' + (which === 'A' ? 'a' : 'b') + '">' + dot +
            '<span>' + escapeHtml(cohort.name) + '</span>' +
            '<span class="tt-val">冲突待裁决</span></div>' +
            '<div class="tt-sub" style="margin-left:21px">' + cands + ' → 不计入窗口</div>');
          return;
        }
        if (inWin) {
          var r = rowsByPeriod.get(p);
          var rate = which === 'A' ? r.rateA : r.rateB;
          var act = which === 'A' ? r.activeA : r.activeB;
          parts.push('<div class="tt-row ' + (which === 'A' ? 'a' : 'b') + '">' + dot +
            '<span>' + escapeHtml(cohort.name) + '</span>' +
            '<span class="tt-val">' + pct(rate) + '</span></div>' +
            '<div class="tt-sub" style="margin-left:21px">活跃 ' + act + ' / 规模 ' + cohort.size + '</div>');
          return;
        }
        if (rows.length) {
          var raw = rows[0].active;
          var ex = result.exclusions.find(function (e) { return e.cohortId === cohort.id && e.period === p; });
          parts.push('<div class="tt-row"><span class="stroke" style="background:' + C.muted + '"></span>' +
            '<span>' + escapeHtml(cohort.name) + '</span>' +
            '<span class="tt-val">' + pct(raw / cohort.size) + '</span></div>');
          parts.push('<div class="tt-excluded">✕ ' + (ex ? exclShort(ex.reasonCode) : '共同窗口外') + '：该点已排除，不当作 0/缺失</div>');
        }
      }

      seriesLine(a, 'A', C.s1);
      seriesLine(b, 'B', C.s2);
      if (inWin) {
        var rr = rowsByPeriod.get(p);
        var d = rr.diff;
        parts.push('<div class="tt-sub" style="margin-top:5px">差额 ' + (d > 0 ? '+' : '') + (d * 100).toFixed(1) + 'pp · ' +
          (rr.direction === 'tie' ? '持平' : rr.direction === 'A' ? escapeHtml(a.name) + ' 领先' : escapeHtml(b.name) + ' 领先') + '</div>');
      }
      tip.innerHTML = parts.join('');
      crosshair.setAttribute('x1', xPos(p));
      crosshair.setAttribute('x2', xPos(p));
      crosshair.setAttribute('opacity', 1);

      var wrapRect = mount.getBoundingClientRect();
      var px = ((xPos(p) / VB_W) * wrapRect.width);
      tip.classList.add('show');
      var tw = tip.offsetWidth || 180;
      var left = Math.max(4, Math.min(px + 14, wrapRect.width - tw - 4));
      tip.style.left = left + 'px';
      tip.style.top = '8px';
    }

    function hideTip() {
      tip.classList.remove('show');
      crosshair.setAttribute('opacity', 0);
    }

    hit.addEventListener('pointermove', function (ev) { showTip(ev.clientX, ev.clientY, nearestPeriod(ev.clientX)); });
    hit.addEventListener('pointerleave', hideTip);
    // 键盘可达：左右方向键逐期查看
    hit.setAttribute('tabindex', '0');
    hit.addEventListener('focus', function () {
      var rect = svg.getBoundingClientRect();
      var clientX = rect.left + (xPos(win.start) / VB_W) * rect.width;
      tip.dataset.p = String(win.start);
      showTip(clientX, 0, win.start);
    });
    hit.addEventListener('blur', hideTip);
    hit.addEventListener('keydown', function (ev) {
      var idx = tip.dataset.p != null ? xs.indexOf(Number(tip.dataset.p)) : xs.indexOf(win.start);
      if (ev.key === 'ArrowRight') idx = Math.min(xs.length - 1, idx + 1);
      else if (ev.key === 'ArrowLeft') idx = Math.max(0, idx - 1);
      else return;
      ev.preventDefault();
      var p = xs[idx];
      tip.dataset.p = String(p);
      var rect = mount.getBoundingClientRect();
      showTip(rect.left + (xPos(p) / VB_W) * rect.width, 0, p);
    });
  }

  function exclShort(code) {
    return {
      BEFORE_WINDOW: '早于共同窗口',
      AFTER_WINDOW: '超出共同窗口',
      GAP_IN_WINDOW: '窗口内缺口',
      UNRESOLVED_CONFLICT: '冲突未裁决',
      OUTSIDE_WINDOW: '无共同窗口',
    }[code] || code;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  window.Charts = { compareChart: compareChart };
})();
