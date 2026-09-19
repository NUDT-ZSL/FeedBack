/* 版式推演引擎（纯函数，浏览器 / Node 通用）
 * 设计原则：同一输入必得同一输出；冲突双方均保留并显式标注，不静默丢弃约束。
 */
(function (global) {
  'use strict';

  var BASELINE_RATIO = 0.8; // 基线位于块高度 80% 处
  var EPS = 1e-9;

  function num(v, d) {
    var n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function fmtMax(v) { return v === Infinity ? '∞' : String(v); }

  function normBlock(b, i) {
    var fixed = null;
    if (b.fixed && typeof b.fixed === 'object') {
      var fw = b.fixed.w == null ? null : num(b.fixed.w, null);
      var fh = b.fixed.h == null ? null : num(b.fixed.h, null);
      if (fw != null || fh != null) fixed = { w: fw, h: fh };
    }
    return {
      id: b.id != null ? String(b.id) : 'b' + i,
      name: b.name != null ? String(b.name) : '块' + (i + 1),
      intrinsicW: num(b.intrinsicW, 100),
      intrinsicH: num(b.intrinsicH, 40),
      flexGrow: num(b.flexGrow, 0),
      minW: num(b.minW, 0),
      maxW: b.maxW == null || b.maxW === '' ? Infinity : num(b.maxW, Infinity),
      minH: num(b.minH, 0),
      maxH: b.maxH == null || b.maxH === '' ? Infinity : num(b.maxH, Infinity),
      canWrap: b.canWrap !== false,
      baselineAlign: b.baselineAlign === true,
      fixed: fixed
    };
  }

  function normContainer(c) {
    c = c || {};
    return {
      width: num(c.width, 640),
      padding: num(c.padding, 16),
      gap: num(c.gap, 12),
      lineGap: num(c.lineGap, 12)
    };
  }

  function newState(blocks) {
    var reasons = {};
    blocks.forEach(function (b) { reasons[b.id] = []; });
    return { conflicts: [], reasons: reasons };
  }

  function addConflict(state, axis, type, parties, detail, line) {
    state.conflicts.push({
      axis: axis, type: type, parties: parties.slice(),
      detail: detail, line: line == null ? null : line
    });
  }

  // 基础尺寸：用户固定值优先，否则固有尺寸夹到 [min, max]
  function baseSize(b, state) {
    var r = state.reasons[b.id];
    var w, h;
    if (b.fixed && b.fixed.w != null) {
      w = b.fixed.w;
      r.push('宽度由用户固定为 ' + w);
      if (w < b.minW) addConflict(state, 'x', 'fixed-vs-min', [b.id, 'minW=' + b.minW],
        '固定宽度 ' + w + ' 小于最小宽度 ' + b.minW + '，两者均保留', null);
      if (w > b.maxW) addConflict(state, 'x', 'fixed-vs-max', [b.id, 'maxW=' + fmtMax(b.maxW)],
        '固定宽度 ' + w + ' 大于最大宽度 ' + fmtMax(b.maxW) + '，两者均保留', null);
    } else {
      w = clamp(b.intrinsicW, b.minW, b.maxW);
      r.push('固有宽度 ' + b.intrinsicW + ' 夹在 [' + b.minW + ', ' + fmtMax(b.maxW) + '] → ' + round2(w));
    }
    if (b.fixed && b.fixed.h != null) {
      h = b.fixed.h;
      r.push('高度由用户固定为 ' + h);
      if (h < b.minH) addConflict(state, 'y', 'fixed-vs-min', [b.id, 'minH=' + b.minH],
        '固定高度 ' + h + ' 小于最小高度 ' + b.minH + '，两者均保留', null);
      if (h > b.maxH) addConflict(state, 'y', 'fixed-vs-max', [b.id, 'maxH=' + fmtMax(b.maxH)],
        '固定高度 ' + h + ' 大于最大高度 ' + fmtMax(b.maxH) + '，两者均保留', null);
    } else {
      h = clamp(b.intrinsicH, b.minH, b.maxH);
      r.push('固有高度 ' + b.intrinsicH + ' 夹在 [' + b.minH + ', ' + fmtMax(b.maxH) + '] → ' + round2(h));
    }
    return { w: w, h: h };
  }

  // 行内剩余空间按伸缩权重分配（受 maxW 约束，水位法），返回剩余留白
  function growLine(items, widths, extra, blocks) {
    var active = [];
    items.forEach(function (idx, k) {
      var b = blocks[idx];
      if (b.fixed && b.fixed.w != null) return;
      if (b.flexGrow > 0 && widths[k] < b.maxW - EPS) active.push(k);
    });
    var guard = 0;
    while (extra > EPS && active.length && guard++ < 64) {
      var wsum = 0;
      active.forEach(function (k) { wsum += blocks[items[k]].flexGrow; });
      var used = 0, next = [];
      active.forEach(function (k) {
        var b = blocks[items[k]];
        var give = extra * b.flexGrow / wsum;
        var cap = b.maxW - widths[k];
        if (give >= cap) { give = cap; } else { next.push(k); }
        widths[k] += give; used += give;
      });
      if (used <= EPS) break;
      extra -= used; active = next;
    }
    return extra;
  }

  // 行内空间不足按权重压缩（受 minW 约束），返回未能吸收的缺口
  function shrinkLine(items, widths, deficit, blocks) {
    var active = [];
    items.forEach(function (idx, k) {
      var b = blocks[idx];
      if (b.fixed && b.fixed.w != null) return;
      if (widths[k] > b.minW + EPS) active.push(k);
    });
    var guard = 0;
    while (deficit > EPS && active.length && guard++ < 64) {
      var wsum = 0;
      active.forEach(function (k) {
        var b = blocks[items[k]];
        wsum += b.flexGrow > 0 ? b.flexGrow : 1;
      });
      var used = 0, next = [];
      active.forEach(function (k) {
        var b = blocks[items[k]];
        var wgt = b.flexGrow > 0 ? b.flexGrow : 1;
        var take = deficit * wgt / wsum;
        var cap = widths[k] - b.minW;
        if (take >= cap) { take = cap; } else { next.push(k); }
        widths[k] -= take; used += take;
      });
      if (used <= EPS) break;
      deficit -= used; active = next;
    }
    return deficit;
  }

  // 从 startIdx 起推导后续所有行（全链重推即 startIdx = 0）
  function computeFrom(blocks, c, state, base, startIdx, startY, lineOffset) {
    var avail = c.width - 2 * c.padding;
    var rawLines = [];
    var cur = { items: [], usedW: 0 };
    var i, b, w, need;
    for (i = startIdx; i < blocks.length; i++) {
      b = blocks[i]; w = base[i].w;
      need = (cur.items.length ? c.gap : 0) + w;
      if (cur.items.length && cur.usedW + need > avail + EPS) {
        if (b.canWrap) {
          state.reasons[b.id].push('行内剩余 ' + round2(avail - cur.usedW) +
            ' 容纳不下 ' + round2(need) + '，按可换行标记移到下一行');
          rawLines.push(cur);
          cur = { items: [i], usedW: w };
          continue;
        }
        addConflict(state, 'x', 'no-wrap-overflow', [b.id, 'container'],
          '「' + b.name + '」标记为不可换行，行宽不足仍保留在原行，溢出 ' +
          round2(cur.usedW + need - avail), lineOffset + rawLines.length);
        state.reasons[b.id].push('不可换行：行宽不足仍留在原行（溢出）');
      }
      cur.items.push(i);
      cur.usedW += need;
    }
    if (cur.items.length) rawLines.push(cur);

    var lines = [], placed = {}, flags = {};
    var y = startY;
    rawLines.forEach(function (raw, li) {
      var lineNo = lineOffset + li;
      var n = raw.items.length;
      var gaps = c.gap * (n - 1);
      var widths = raw.items.map(function (idx) { return base[idx].w; });
      var sumW = widths.reduce(function (a, v) { return a + v; }, 0);
      var extra = avail - gaps - sumW;
      var freeSpace = 0;
      if (extra > EPS) {
        freeSpace = growLine(raw.items, widths, extra, blocks);
      } else if (extra < -EPS) {
        var left = shrinkLine(raw.items, widths, -extra, blocks);
        var squeezedIds = [];
        raw.items.forEach(function (idx, k) {
          if (widths[k] < base[idx].w - EPS) {
            flags[blocks[idx].id] = flags[blocks[idx].id] || {};
            flags[blocks[idx].id].squeezed = true;
            squeezedIds.push(blocks[idx].id);
          }
        });
        if (squeezedIds.length) {
          addConflict(state, 'x', 'squeezed', squeezedIds.concat(['container']),
            '行内空间不足，' + squeezedIds.length + ' 个块被压缩（间距 ' + c.gap +
            ' 与各块最小宽度约束均保留）', lineNo);
        }
        if (left > EPS) {
          addConflict(state, 'x', 'squeeze-overflow',
            raw.items.map(function (idx) { return blocks[idx].id; }).concat(['container', 'gap=' + c.gap]),
            '各块已压至最小宽度仍超出容器 ' + round2(left) +
            '；间距与最小宽度均不丢弃，产生溢出', lineNo);
        }
      }
      raw.items.forEach(function (idx, k) {
        var diff = widths[k] - base[idx].w;
        if (Math.abs(diff) > 0.005) {
          state.reasons[blocks[idx].id].push('伸缩权重 ' + blocks[idx].flexGrow +
            '，行内空间' + (diff > 0 ? '剩余' : '不足') + '，宽度 ' +
            round2(base[idx].w) + ' → ' + round2(widths[k]));
        }
      });
      // 行高与基线共同决定纵向位置
      var heights = raw.items.map(function (idx) { return base[idx].h; });
      var baseline = 0;
      raw.items.forEach(function (idx, k) {
        if (blocks[idx].baselineAlign) baseline = Math.max(baseline, heights[k] * BASELINE_RATIO);
      });
      var lineH = 0;
      raw.items.forEach(function (idx, k) {
        var ext = blocks[idx].baselineAlign ? baseline + heights[k] * (1 - BASELINE_RATIO) : heights[k];
        lineH = Math.max(lineH, ext);
      });
      var x = c.padding;
      raw.items.forEach(function (idx, k) {
        var bb = blocks[idx];
        var yOff = bb.baselineAlign ? baseline - heights[k] * BASELINE_RATIO : 0;
        placed[bb.id] = { x: round2(x), y: round2(y + yOff), w: round2(widths[k]), h: round2(heights[k]), line: lineNo };
        if (k === 0) state.reasons[bb.id].push('x 起点 = 容器内边距 ' + c.padding);
        if (k > 0) state.reasons[bb.id].push('与前一块的间距 ' + c.gap);
        if (bb.baselineAlign) state.reasons[bb.id].push('基线对齐：行基线 ' + round2(baseline) +
          '，块基线 ' + round2(heights[k] * BASELINE_RATIO) + '，纵向偏移 ' + round2(yOff));
        else state.reasons[bb.id].push('顶对齐：行高 ' + round2(lineH) + ' 由行内最高块决定');
        x += widths[k] + c.gap;
      });
      raw.items.forEach(function (idx) {
        var p = placed[blocks[idx].id];
        if (p.x + p.w > c.width - c.padding + 0.01) {
          flags[blocks[idx].id] = flags[blocks[idx].id] || {};
          flags[blocks[idx].id].overflow = true;
        }
      });
      lines.push({ index: lineNo, items: raw.items.slice(), y: round2(y),
        height: round2(lineH), baseline: round2(baseline), freeSpace: round2(Math.max(0, freeSpace)) });
      y += lineH + c.lineGap;
    });
    return { lines: lines, placed: placed, flags: flags };
  }

  function assemble(blocks, c, state, part, kept) {
    var ids = blocks.map(function (b) { return b.id; });
    var lines = (kept ? kept.lines : []).concat(part.lines);
    var placed = {}, flags = {}, reasons = {};
    ids.forEach(function (id) {
      if (kept && kept.placed[id]) placed[id] = kept.placed[id];
      else if (part.placed[id]) placed[id] = part.placed[id];
      var f = (kept && kept.flags[id]) || part.flags[id] || {};
      flags[id] = { squeezed: !!f.squeezed, overflow: !!f.overflow };
      reasons[id] = kept && kept.reasons[id] ? kept.reasons[id] : state.reasons[id];
    });
    var conflicts = (kept ? kept.conflicts : []).concat(state.conflicts);
    conflicts = conflicts.slice().sort(function (a, b2) {
      var la = a.line == null ? -1 : a.line;
      var lb = b2.line == null ? -1 : b2.line;
      return la - lb;
    });
    var blocksView = {};
    ids.forEach(function (id) {
      var p = placed[id] || { x: 0, y: 0, w: 0, h: 0, line: -1 };
      blocksView[id] = { x: p.x, y: p.y, w: p.w, h: p.h, line: p.line,
        squeezed: flags[id].squeezed, overflow: flags[id].overflow };
    });
    var contentH = lines.length
      ? lines[lines.length - 1].y + lines[lines.length - 1].height + c.padding
      : c.padding * 2;
    var result = {
      container: c, blockIds: ids, lines: lines,
      placed: placed, flags: flags, reasons: reasons,
      blocks: blocksView, conflicts: conflicts,
      contentHeight: round2(contentH)
    };
    result.hash = hashResult(result);
    return result;
  }

  function hashResult(result) {
    var s = JSON.stringify(result.blockIds.map(function (id) {
      var p = result.placed[id] || {};
      return [id, p.x, p.y, p.w, p.h];
    }));
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  // 全链重推
  function layout(blocksInput, containerInput) {
    var blocks = blocksInput.map(normBlock);
    var c = normContainer(containerInput);
    var state = newState(blocks);
    var base = blocks.map(function (b) { return baseSize(b, state); });
    var part = computeFrom(blocks, c, state, base, 0, c.padding, 0);
    return assemble(blocks, c, state, part, null);
  }

  // 增量重推：仅重推变更块所在行及其后续区域，结果与全链重推一致
  function layoutIncremental(prev, blocksInput, containerInput, changedId) {
    var blocks = blocksInput.map(normBlock);
    var c = normContainer(containerInput);
    function full(reason) {
      return { result: layout(blocksInput, containerInput), mode: 'full', reason: reason };
    }
    if (!prev || !prev.blockIds) return full('无前一结果');
    var ids = blocks.map(function (b) { return b.id; });
    if (JSON.stringify(ids) !== JSON.stringify(prev.blockIds)) return full('块集合变化');
    if (JSON.stringify(c) !== JSON.stringify(prev.container)) return full('容器参数变化');
    var hit = prev.blocks[changedId];
    if (!hit || hit.line == null || hit.line < 0) return full('未知变更块');
    var startLine = hit.line;
    var startIdx = prev.lines[startLine].items[0];
    var startY = startLine === 0 ? c.padding
      : prev.lines[startLine - 1].y + prev.lines[startLine - 1].height + c.lineGap;
    var state = newState(blocks);
    var base = blocks.map(function (b) { return baseSize(b, state); });
    var part = computeFrom(blocks, c, state, base, startIdx, startY, startLine);
    var kept = { lines: prev.lines.slice(0, startLine), placed: {}, flags: {}, reasons: {}, conflicts: [] };
    kept.lines.forEach(function (l) {
      l.items.forEach(function (idx) {
        var id = prev.blockIds[idx];
        kept.placed[id] = prev.placed[id];
        kept.flags[id] = prev.flags[id];
        kept.reasons[id] = prev.reasons[id];
      });
    });
    kept.conflicts = prev.conflicts.filter(function (cf) {
      return cf.line != null && cf.line < startLine;
    });
    return { result: assemble(blocks, c, state, part, kept), mode: 'partial', fromLine: startLine };
  }

  var API = {
    layout: layout,
    layoutIncremental: layoutIncremental,
    hashResult: hashResult,
    BASELINE_RATIO: BASELINE_RATIO
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.LayoutEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
