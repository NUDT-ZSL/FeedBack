/*
 * engine.js — 版式推演内核（纯函数，无 DOM 依赖，浏览器与 Node 通用）
 *
 * 输入模型
 *   container: { width, padL, padR, padT, padB, gapX, gapY }
 *   blocks: [{ id, name, width, height, grow, shrink, minW, maxW,
 *              canBreakBefore, baseline, pinned, pinnedWidth }]
 *
 * 推演顺序（同一条链，顺序确定，保证同一输入结果一致）：
 *   1) 贪心断行（仅允许在 canBreakBefore 的块前断行）
 *   2) 行内轴向分配：grow 吸收剩余 / shrink 吸收超出，受 minW/maxW 钳制
 *   3) pinned 尺寸视为硬约束，与容器/最小最大冲突时双方保留并记录
 *   4) 行高由基线对齐共同决定
 *   5) 位置 = 容器内边距 + 间距(gapX/gapY) 累计
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayoutEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EPS = 1e-9;

  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  function normalizeContainer(c) {
    c = c || {};
    return {
      width: Math.max(0, num(c.width, 600)),
      padL: Math.max(0, num(c.padL, 0)),
      padR: Math.max(0, num(c.padR, 0)),
      padT: Math.max(0, num(c.padT, 0)),
      padB: Math.max(0, num(c.padB, 0)),
      gapX: Math.max(0, num(c.gapX, 0)),
      gapY: Math.max(0, num(c.gapY, 0))
    };
  }

  function normalizeBlock(b, i) {
    var w = Math.max(0, num(b.width, 50));
    var h = Math.max(0, num(b.height, 30));
    return {
      id: b.id != null ? String(b.id) : "blk-" + i,
      name: b.name != null ? String(b.name) : "块 " + (i + 1),
      width: w,
      height: h,
      grow: Math.max(0, num(b.grow, 0)),
      shrink: Math.max(0, num(b.shrink, 1)),
      minW: Math.max(0, num(b.minW, 0)),
      maxW: b.maxW == null || b.maxW === "" ? Infinity : Math.max(0, num(b.maxW, Infinity)),
      canBreakBefore: !!b.canBreakBefore,
      baseline: Math.max(0, num(b.baseline, h)),
      pinned: !!b.pinned,
      pinnedWidth: Math.max(0, num(b.pinnedWidth, w))
    };
  }

  /* ---------- 第 1 步：贪心断行 ---------- */
  function breakLines(blocks, contentWidth, gapX) {
    var lines = [];
    var cur = [];
    var curW = 0;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var bw = b.pinned ? b.pinnedWidth : b.width;
      var need = cur.length === 0 ? bw : curW + gapX + bw;
      if (cur.length > 0 && b.canBreakBefore && need > contentWidth + EPS) {
        lines.push(cur);
        cur = [b];
        curW = bw;
      } else {
        cur.push(b);
        curW = need;
      }
    }
    if (cur.length > 0) lines.push(cur);
    return lines;
  }

  /* ---------- 第 2/3 步：行内轴向分配 ----------
   * 返回 { widths: Map(id->w), states: Map(id->state), reasons, conflicts }
   * state ∈ normal | grow | shrink | squeezed | overflow | pinned
   */
  function resolveLineWidths(lineBlocks, contentWidth, gapX, conflicts) {
    var n = lineBlocks.length;
    var avail = contentWidth - gapX * (n - 1);
    var widths = {};
    var states = {};
    var reasons = {};
    var i, b, id;

    // 初始宽度：pinned 用固定值，其余用固有尺寸
    var total = 0;
    for (i = 0; i < n; i++) {
      b = lineBlocks[i];
      id = b.id;
      widths[id] = b.pinned ? b.pinnedWidth : b.width;
      states[id] = b.pinned ? "pinned" : "normal";
      reasons[id] = [];
      if (b.pinned) {
        reasons[id].push("手动固定宽度 " + fmt(b.pinnedWidth));
        if (b.pinnedWidth < b.minW - EPS || b.pinnedWidth > b.maxW + EPS) {
          conflicts.push({
            axis: "x", type: "pin-vs-bounds", blockIds: [id],
            keepA: "固定宽度 " + fmt(b.pinnedWidth),
            keepB: "边界 [" + fmt(b.minW) + ", " + fmt(b.maxW) + "]",
            detail: b.name + "：固定尺寸与自身最小/最大边界冲突，两者均保留"
          });
        }
      }
      total += widths[id];
    }

    var diff = avail - total; // >0 需要拉伸，<0 需要压缩

    if (diff > EPS) {
      // 拉伸：按 grow 比例分配，受 maxW 钳制，多轮直到分完或无人可伸
      var remaining = diff;
      for (var round = 0; round < n + 1 && remaining > EPS; round++) {
        var growSum = 0;
        for (i = 0; i < n; i++) {
          b = lineBlocks[i];
          if (!b.pinned && b.grow > 0 && widths[b.id] < b.maxW - EPS) growSum += b.grow;
        }
        if (growSum <= EPS) break;
        var used = 0;
        for (i = 0; i < n; i++) {
          b = lineBlocks[i]; id = b.id;
          if (b.pinned || b.grow <= 0 || widths[id] >= b.maxW - EPS) continue;
          var share = remaining * (b.grow / growSum);
          var room = b.maxW - widths[id];
          var add = Math.min(share, room);
          widths[id] += add;
          used += add;
          if (widths[id] >= b.maxW - EPS) {
            reasons[id].push("拉伸至最大边界 " + fmt(b.maxW));
          }
        }
        if (used <= EPS) break;
        remaining -= used;
      }
      for (i = 0; i < n; i++) {
        b = lineBlocks[i]; id = b.id;
        if (!b.pinned && widths[id] > b.width + EPS) {
          states[id] = "grow";
          reasons[id].unshift("按 grow=" + fmt(b.grow) + " 吸收行内剩余空间");
        }
      }
    } else if (diff < -EPS) {
      // 压缩：按 shrink*固有宽度 加权，受 minW 钳制
      var excess = -diff;
      for (var r2 = 0; r2 < n + 1 && excess > EPS; r2++) {
        var wSum = 0;
        for (i = 0; i < n; i++) {
          b = lineBlocks[i];
          if (!b.pinned && b.shrink > 0 && widths[b.id] > b.minW + EPS) {
            wSum += b.shrink * Math.max(b.width, EPS);
          }
        }
        if (wSum <= EPS) break;
        var cut = 0;
        for (i = 0; i < n; i++) {
          b = lineBlocks[i]; id = b.id;
          if (b.pinned || b.shrink <= 0 || widths[id] <= b.minW + EPS) continue;
          var weight = (b.shrink * Math.max(b.width, EPS)) / wSum;
          var give = Math.min(excess * weight, widths[id] - b.minW);
          widths[id] -= give;
          cut += give;
          if (widths[id] <= b.minW + EPS) {
            reasons[id].push("压缩至最小边界 " + fmt(b.minW));
          }
        }
        if (cut <= EPS) break;
        excess -= cut;
      }
      for (i = 0; i < n; i++) {
        b = lineBlocks[i]; id = b.id;
        if (!b.pinned && widths[id] < b.width - EPS) {
          states[id] = widths[id] <= b.minW + EPS ? "squeezed" : "shrink";
          reasons[id].unshift("按 shrink=" + fmt(b.shrink) + " 承担行内压缩");
        }
      }
      // 全部压到 minW 仍装不下 → 溢出，双方保留
      if (excess > EPS) {
        var victims = [];
        for (i = 0; i < n; i++) {
          b = lineBlocks[i]; id = b.id;
          states[id] = "overflow";
          victims.push(id);
          reasons[id].push("行内容纳不下，溢出 " + fmt(excess));
        }
        var pinnedIds = [];
        for (i = 0; i < n; i++) if (lineBlocks[i].pinned) pinnedIds.push(lineBlocks[i].id);
        conflicts.push({
          axis: "x", type: "overflow", blockIds: victims,
          keepA: "各块最小宽度/固定宽度之和不减",
          keepB: "容器内容宽度 " + fmt(contentWidth) + "（缺口 " + fmt(excess) + "）",
          detail: "该行最小需求超出容器 " + fmt(excess) +
            (pinnedIds.length ? "；含固定块 " + pinnedIds.join(", ") : "")
        });
      }
    }

    return { widths: widths, states: states, reasons: reasons };
  }

  function fmt(v) {
    if (!isFinite(v)) return "∞";
    return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1);
  }

  /* ---------- 整链求解 ----------
   * opts.startLineIndex / opts.presetLines 供增量重推复用前缀行，
   * 全量求解时从第 0 行开始。
   */
  function solve(containerInput, blocksInput, opts) {
    opts = opts || {};
    var container = normalizeContainer(containerInput);
    var blocks = (blocksInput || []).map(normalizeBlock);
    var contentWidth = Math.max(0, container.width - container.padL - container.padR);
    var conflicts = (opts.presetConflicts || []).slice();
    var placements = {};
    var linesOut = [];

    var allLines = breakLines(blocks, contentWidth, container.gapX);
    var startLine = opts.startLineIndex || 0;
    var y = container.padT;

    if (opts.presetLines) {
      for (var p = 0; p < opts.presetLines.length; p++) {
        var pl = opts.presetLines[p];
        linesOut.push(pl.line);
        y = pl.nextY;
        for (var pid in pl.placements) placements[pid] = pl.placements[pid];
      }
    }

    for (var li = startLine; li < allLines.length; li++) {
      var lineBlocks = allLines[li];
      var res = resolveLineWidths(lineBlocks, contentWidth, container.gapX, conflicts);

      // 第 4 步：行高由基线对齐共同决定
      var baseline = 0, belowMax = 0;
      for (var i = 0; i < lineBlocks.length; i++) {
        var b = lineBlocks[i];
        if (b.baseline > baseline) baseline = b.baseline;
        var below = b.height - b.baseline;
        if (below > belowMax) belowMax = below;
      }
      var lineHeight = baseline + belowMax;

      // 第 5 步：位置 = 内边距 + 间距累计
      var x = container.padL;
      var ids = [];
      for (i = 0; i < lineBlocks.length; i++) {
        b = lineBlocks[i];
        var id = b.id;
        ids.push(id);
        placements[id] = {
          x: x,
          y: y + (baseline - b.baseline),
          width: res.widths[id],
          height: b.height,
          line: li,
          state: res.states[id],
          reasons: res.reasons[id]
        };
        x += res.widths[id] + container.gapX;
      }
      linesOut.push({ index: li, blockIds: ids, y: y, height: lineHeight, baseline: baseline });
      y += lineHeight + container.gapY;
    }

    var totalHeight = linesOut.length
      ? y - container.gapY + container.padB
      : container.padT + container.padB;

    return {
      container: container,
      contentWidth: contentWidth,
      lines: linesOut,
      placements: placements,
      conflicts: conflicts,
      totalHeight: totalHeight
    };
  }

  /* ---------- 增量重推 ----------
   * 只重推首个受影响行及其后续行，前缀行直接复用上次结果；
   * 完成后与整链全量重推逐块比对，不一致则回退全量并标记。
   */
  function solveIncremental(prevResult, containerInput, blocksInput, changedIds) {
    var container = normalizeContainer(containerInput);
    var changed = {};
    (changedIds || []).forEach(function (id) { changed[String(id)] = true; });

    var containerChanged =
      !prevResult ||
      JSON.stringify(prevResult.container) !== JSON.stringify(container);

    var startLine = 0;
    if (!containerChanged) {
      startLine = Infinity;
      for (var id in changed) {
        var pl = prevResult.placements[id];
        if (pl) {
          var ln = pl.line;
          // 行首块的断行决策依赖其自身宽度，尺寸变化可能使其上移一行
          var lineObj = prevResult.lines[ln];
          if (lineObj && lineObj.blockIds[0] === id && ln > 0) ln -= 1;
          if (ln < startLine) startLine = ln;
        }
        if (!pl) { startLine = 0; break; } // 新块或未知块：保守全推
      }
      if (startLine === Infinity) startLine = prevResult.lines.length; // 无受影响行
    }

    var presetLines = [];
    var presetConflicts = [];
    if (!containerChanged && startLine > 0) {
      var inPreset = {};
      for (var i = 0; i < Math.min(startLine, prevResult.lines.length); i++) {
        var line = prevResult.lines[i];
        var pls = {};
        line.blockIds.forEach(function (bid) {
          pls[bid] = prevResult.placements[bid];
          inPreset[bid] = true;
        });
        presetLines.push({
          line: line,
          placements: pls,
          nextY: line.y + line.height + container.gapY
        });
      }
      prevResult.conflicts.forEach(function (c) {
        var allPreset = c.blockIds.every(function (bid) { return inPreset[bid]; });
        if (allPreset) presetConflicts.push(c);
      });
    }

    var partial = solve(containerInput, blocksInput, {
      startLineIndex: startLine,
      presetLines: presetLines,
      presetConflicts: presetConflicts
    });

    // 一致性校验：与整链完全重推比对
    var full = solve(containerInput, blocksInput);
    var consistent = resultsEqual(partial, full);
    var finalResult = consistent ? partial : full;

    return {
      result: finalResult,
      consistentWithFull: consistent,
      resolvedFromLine: Math.min(startLine, full.lines.length),
      totalLines: full.lines.length,
      fellBackToFull: !consistent
    };
  }

  function resultsEqual(a, b) {
    var ka = Object.keys(a.placements), kb = Object.keys(b.placements);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var pa = a.placements[ka[i]], pb = b.placements[ka[i]];
      if (!pb) return false;
      if (Math.abs(pa.x - pb.x) > 1e-6 || Math.abs(pa.y - pb.y) > 1e-6 ||
          Math.abs(pa.width - pb.width) > 1e-6 || pa.line !== pb.line ||
          pa.state !== pb.state) return false;
    }
    if (a.lines.length !== b.lines.length) return false;
    for (i = 0; i < a.lines.length; i++) {
      if (Math.abs(a.lines[i].y - b.lines[i].y) > 1e-6 ||
          Math.abs(a.lines[i].height - b.lines[i].height) > 1e-6) return false;
    }
    if (a.conflicts.length !== b.conflicts.length) return false;
    for (i = 0; i < a.conflicts.length; i++) {
      if (a.conflicts[i].type !== b.conflicts[i].type ||
          a.conflicts[i].blockIds.join(",") !== b.conflicts[i].blockIds.join(",")) return false;
    }
    return true;
  }

  return {
    solve: solve,
    solveIncremental: solveIncremental,
    normalizeContainer: normalizeContainer,
    normalizeBlock: normalizeBlock,
    resultsEqual: resultsEqual
  };
});
