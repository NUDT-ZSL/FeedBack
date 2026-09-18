// 专注会话恢复工作台 —— 纯函数推导引擎
// 不依赖 DOM：浏览器中作为普通脚本挂到 window.FocusEngine（file:// 直接打开即可用），
// Node 中通过 module.exports 供测试引用。
//
// 核心模型：工作钟（work clock）
//   会话在墙钟区间 [session.startMin, session.nowMin) 上进行。
//   净打断区间是从墙钟中扣除的时间；剩余部分构成"工作钟"。
//   各阶段按顺序依次占满工作钟：阶段 k 占工作钟区间 [B_{k-1}, B_k)，B_k 为预算累计。
//   阶段计入时长 = 其工作钟区间与 [0, 总工作时长) 的交叠长度。
//   因此任意时刻：计入 + 剩余 = 预算（守恒），且同一墙钟时刻不可能被计两次。

const REPORT_STATUS = Object.freeze({ ACTIVE: 'active', RESOLVED: 'resolved' });

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 1. 阶段校验：时长非正、顺序重复一律拒绝并指出位置
// ---------------------------------------------------------------------------
function validateStages(stages) {
  const errors = [];
  const firstIndexByOrder = new Map();
  stages.forEach((st, idx) => {
    const pos = idx + 1;
    if (!Number.isInteger(st.order)) {
      errors.push({ stageIndex: idx, reason: `第 ${pos} 个阶段「${st.name ?? ''}」的顺序号必须为整数，当前为 ${st.order}` });
    } else if (firstIndexByOrder.has(st.order)) {
      errors.push({
        stageIndex: idx,
        reason: `第 ${pos} 个阶段「${st.name ?? ''}」与第 ${firstIndexByOrder.get(st.order) + 1} 个阶段顺序重复（均为 ${st.order}）`,
      });
    } else {
      firstIndexByOrder.set(st.order, idx);
    }
    if (!Number.isFinite(st.budgetMin) || st.budgetMin <= 0) {
      errors.push({
        stageIndex: idx,
        reason: `第 ${pos} 个阶段「${st.name ?? ''}」（顺序 ${st.order}）预算时长必须为正数，当前为 ${st.budgetMin}`,
      });
    }
    if (!st.name || !String(st.name).trim()) {
      errors.push({ stageIndex: idx, reason: `第 ${pos} 个阶段（顺序 ${st.order}）缺少名称` });
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// 2. 打断报告校验：零长、起止颠倒一律拒绝
// ---------------------------------------------------------------------------
function validateReport(rep) {
  if (!rep || typeof rep !== 'object') return '报告为空';
  if (!rep.id || !String(rep.id).trim()) return '缺少打断标识';
  if (!rep.source || !String(rep.source).trim()) return `打断「${rep.id}」缺少来源`;
  if (!Number.isFinite(rep.start) || !Number.isFinite(rep.end)) {
    return `打断「${rep.id}」（来源 ${rep.source}）区间起止必须为数值`;
  }
  if (rep.end < rep.start) {
    return `打断「${rep.id}」（来源 ${rep.source}）区间起止颠倒：起 ${rep.start} > 止 ${rep.end}`;
  }
  if (rep.end === rep.start) {
    return `打断「${rep.id}」（来源 ${rep.source}）零长区间（${rep.start}）不允许`;
  }
  if (!Object.values(REPORT_STATUS).includes(rep.status)) {
    return `打断「${rep.id}」（来源 ${rep.source}）消解状态未知：${rep.status}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. 报告分组与冲突检测
//    同一打断 id 的多份报告：
//      - 区间与消解结论完全一致 → 视为同一事实，合并来源；
//      - 互相矛盾 → 双方全部保留，生成可读冲突记录，且该打断暂不纳入推导（不静默择一）；
//      - 用户已采纳其中一份（adopted）→ 以采纳方为准，其余保留为未采纳。
// ---------------------------------------------------------------------------
function analyzeReports(reports) {
  const rejections = [];
  const byId = new Map();
  for (const rep of reports) {
    const reason = validateReport(rep);
    if (reason) {
      rejections.push({ report: rep, reason });
      continue;
    }
    if (!byId.has(rep.id)) byId.set(rep.id, []);
    byId.get(rep.id).push(rep);
  }

  const groups = [];
  for (const [id, reps] of byId) {
    const adopted = reps.filter((r) => r.adopted);
    let effective = null;
    let conflict = null;
    let hadConflict = false;

    const [first] = reps;
    const agree = reps.every((r) => r.start === first.start && r.end === first.end && r.status === first.status);

    if (adopted.length > 0) {
      const chosen = adopted[0];
      effective = { id, start: chosen.start, end: chosen.end, status: chosen.status, source: chosen.source };
      hadConflict = !agree;
    } else if (agree) {
      effective = {
        id,
        start: first.start,
        end: first.end,
        status: first.status,
        source: reps.map((r) => r.source).join('、'),
      };
    } else {
      hadConflict = true;
      conflict = {
        id,
        parties: reps.map((r) => ({ uid: r.uid, source: r.source, start: r.start, end: r.end, status: r.status })),
        message:
          `打断「${id}」存在互相矛盾的报告：` +
          reps
            .map(
              (r) =>
                `来源「${r.source}」报区间 [${r.start}, ${r.end})、${r.status === REPORT_STATUS.ACTIVE ? '未消解' : '已消解'}`,
            )
            .join('；') +
          '。双方均已保留，该打断暂不纳入推导，请人工消解。',
      };
    }
    groups.push({ id, reports: [...reps], effective, conflict, hadConflict });
  }
  // 确定性排序，保证同批记录重复推导结果一致
  groups.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { groups, rejections };
}

// ---------------------------------------------------------------------------
// 4. 净打断区间：裁剪到会话范围（越界说明），再按确定性规则归并重叠区间
// ---------------------------------------------------------------------------
function buildNetIntervals(effectiveIntervals, startMin, nowMin) {
  const notes = [];
  const clipped = [];
  for (const iv of effectiveIntervals) {
    if (iv.status !== REPORT_STATUS.ACTIVE) continue; // 已消解的打断不占工作时间
    const s = Math.max(iv.start, startMin);
    const e = Math.min(iv.end, nowMin);
    if (e <= s) {
      notes.push({
        type: 'clipped-away',
        id: iv.id,
        source: iv.source,
        message: `打断「${iv.id}」（来源 ${iv.source}）区间 [${iv.start}, ${iv.end}) 完全落在会话范围 [${startMin}, ${nowMin}) 之外，已整体裁掉`,
      });
      continue;
    }
    if (s !== iv.start || e !== iv.end) {
      notes.push({
        type: 'clipped',
        id: iv.id,
        source: iv.source,
        message: `打断「${iv.id}」（来源 ${iv.source}）区间 [${iv.start}, ${iv.end}) 越界部分已裁掉，保留 [${s}, ${e})`,
      });
    }
    clipped.push({ start: s, end: e, refs: [{ id: iv.id, source: iv.source }] });
  }
  // 确定性归并：按 (起点, 终点, 打断标识) 排序后扫描，重叠或首尾相接即合并
  clipped.sort(
    (a, b) => a.start - b.start || a.end - b.end || String(a.refs[0].id).localeCompare(String(b.refs[0].id)),
  );
  const net = [];
  for (const iv of clipped) {
    const last = net[net.length - 1];
    if (last && iv.start <= last.end + EPS) {
      if (iv.end > last.end) last.end = iv.end;
      last.refs.push(...iv.refs);
    } else {
      net.push({ start: iv.start, end: iv.end, refs: [...iv.refs] });
    }
  }
  return { net, notes };
}

// ---------------------------------------------------------------------------
// 5. 工作钟换算
// ---------------------------------------------------------------------------
function coverageBetween(net, a, b) {
  let c = 0;
  for (const iv of net) {
    const s = Math.max(iv.start, a);
    const e = Math.min(iv.end, b);
    if (e > s) c += e - s;
  }
  return c;
}

// 墙钟时刻 t 对应的工作钟读数
function workAt(net, startMin, t) {
  return Math.max(0, t - startMin - coverageBetween(net, startMin, t));
}

// 工作钟读数 w 对应的墙钟时刻（逆映射）
function wallAt(net, startMin, w) {
  let cur = startMin;
  let done = 0;
  for (const iv of net) {
    const gap = iv.start - cur;
    if (done + gap >= w - EPS) return cur + (w - done);
    done += gap;
    cur = iv.end;
  }
  return cur + (w - done);
}

// ---------------------------------------------------------------------------
// 6. 推导：各阶段计入时长、剩余额度、墙钟位置、继续进入位置
// ---------------------------------------------------------------------------
function derive(session, stages, net) {
  const S = session.startMin;
  const N = session.nowMin;
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const totalWorkMin = workAt(net, S, N);

  let cum = 0;
  const rows = ordered.map((st) => {
    const wStart = cum;
    const wEnd = cum + st.budgetMin;
    cum = wEnd;
    const countedMin = Math.min(Math.max(totalWorkMin - wStart, 0), st.budgetMin);
    const wallStart = wallAt(net, S, wStart);
    const wallEnd = wallAt(net, S, wEnd);
    const countedWallEnd = wallAt(net, S, Math.min(wEnd, totalWorkMin));
    return {
      id: st.id,
      order: st.order,
      name: st.name,
      budgetMin: st.budgetMin,
      countedMin,
      remainingMin: st.budgetMin - countedMin,
      status: countedMin <= EPS ? 'pending' : countedMin >= st.budgetMin - EPS ? 'done' : 'active',
      wStart,
      wEnd,
      wallStart,
      wallEnd,
      countedWallEnd,
    };
  });

  const frontier = rows.find((r) => r.remainingMin > EPS);
  const resume = frontier
    ? {
        stageId: frontier.id,
        stageName: frontier.name,
        order: frontier.order,
        offsetMin: frontier.countedMin,
        remainingMin: frontier.remainingMin,
      }
    : null;

  return {
    rows,
    resume,
    totalWorkMin,
    totalBudgetMin: cum,
    conservationOk: rows.every((r) => Math.abs(r.countedMin + r.remainingMin - r.budgetMin) < EPS),
  };
}

// ---------------------------------------------------------------------------
// 7. 区间差集（base 中未被 cut 覆盖的部分），两者均需已排序且不重叠
// ---------------------------------------------------------------------------
function intervalSubtract(base, cut) {
  const res = [];
  let j = 0;
  for (const iv of base) {
    let cur = iv.start;
    while (j < cut.length && cut[j].end <= cur + EPS) j++;
    let k = j;
    while (k < cut.length && cut[k].start < iv.end - EPS) {
      if (cut[k].start > cur + EPS) res.push({ start: cur, end: Math.min(cut[k].start, iv.end) });
      cur = Math.max(cur, cut[k].end);
      if (cur >= iv.end - EPS) break;
      k++;
    }
    if (cur < iv.end - EPS) res.push({ start: cur, end: iv.end });
  }
  return res.filter((r) => r.end - r.start > EPS);
}

// ---------------------------------------------------------------------------
// 8. 整体重算：校验 → 冲突 → 净区间 → 推导，一次产出界面所需的全部结果
// ---------------------------------------------------------------------------
function recompute(session, stages, reports) {
  const stageErrors = validateStages(stages);
  const { groups, rejections } = analyzeReports(reports);
  const conflicts = groups.filter((g) => g.conflict).map((g) => g.conflict);
  const effective = groups.map((g) => g.effective).filter(Boolean);
  const { net, notes } = buildNetIntervals(effective, session.startMin, session.nowMin);
  const derivation = stageErrors.length === 0 ? derive(session, stages, net) : null;
  return { stageErrors, rejections, groups, conflicts, net, clipNotes: notes, derivation };
}

// ---------------------------------------------------------------------------
// 9. 推导差分：扣减（重复计入被扣掉）、回补、平移、未受影响
// ---------------------------------------------------------------------------
function diffDerivations(before, after) {
  const beforeById = new Map(before.rows.map((r) => [r.id, r]));
  const deductions = [];
  const restored = [];
  const shifted = [];
  const unaffected = [];
  for (const row of after.rows) {
    const b = beforeById.get(row.id);
    if (!b) continue;
    const dCounted = row.countedMin - b.countedMin;
    const dStart = row.wallStart - b.wallStart;
    const dEnd = row.wallEnd - b.wallEnd;
    if (dCounted < -EPS) {
      deductions.push({ stageId: row.id, name: row.name, order: row.order, amountMin: -dCounted });
    } else if (dCounted > EPS) {
      restored.push({ stageId: row.id, name: row.name, order: row.order, amountMin: dCounted });
    }
    if (Math.abs(dCounted) <= EPS && Math.abs(dStart) <= EPS && Math.abs(dEnd) <= EPS) {
      unaffected.push(row.id);
    } else if (Math.abs(dCounted) <= EPS) {
      shifted.push({ stageId: row.id, name: row.name, order: row.order, shiftMin: dStart });
    }
  }
  return { deductions, restored, shifted, unaffected };
}

// ---------------------------------------------------------------------------
// 10. 事后补报：校验 → 重推 → 差分，产出扣减/裁剪/影响说明
// ---------------------------------------------------------------------------
function backfillReport(session, stages, reports, newReport) {
  const reason = validateReport(newReport);
  if (reason) return { ok: false, reason };
  const before = recompute(session, stages, reports);
  const after = recompute(session, stages, [...reports, newReport]);
  const newNetParts = intervalSubtract(after.net, before.net); // 净打断新增部分
  const droppedNetParts = intervalSubtract(before.net, after.net); // 净打断移除部分（如冲突导致排除）
  const diff =
    before.derivation && after.derivation ? diffDerivations(before.derivation, after.derivation) : null;
  return { ok: true, before, after, newNetParts, droppedNetParts, diff };
}

// ---------------------------------------------------------------------------
// 导出：浏览器挂全局，Node 走 CommonJS
// ---------------------------------------------------------------------------
const FocusEngine = {
  REPORT_STATUS,
  validateStages,
  validateReport,
  analyzeReports,
  buildNetIntervals,
  coverageBetween,
  workAt,
  wallAt,
  derive,
  intervalSubtract,
  recompute,
  diffDerivations,
  backfillReport,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FocusEngine;
} else {
  globalThis.FocusEngine = FocusEngine;
}
