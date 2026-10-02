// 浑仪拆装步骤状态机（纯 ESM、零依赖，浏览器与 Node 离线环境共用）。
//
// 模型约定：
// - 每个部件用 deps 声明“装回时必须先在位”的部件。
// - 拆下方向相反：deps 指向的部件，必须等本部件拆下后才能拆下。
// - 状态仅为“已在位部件集合”，所有步骤状态、受阻原因、进度结论均由
//   该集合 + 静态依赖关系推导，因此同一集合无论以何种操作序列到达，
//   结论必然一致（与历史路径无关）。

const VALID_OPS = new Set(['disassemble', 'reassemble']);

export function createArmillaryMachine(config = {}) {
  const partList = (config.parts ?? []).map((p) => {
    if (!p || typeof p.id !== 'string' || p.id.length === 0) {
      throw new Error('部件配置非法：缺少非空 id');
    }
    return { id: p.id, label: typeof p.label === 'string' && p.label ? p.label : p.id, deps: Array.isArray(p.deps) ? [...p.deps] : [] };
  });

  const partIds = partList.map((p) => p.id);
  const byId = new Map(partList.map((p) => [p.id, p]));
  if (byId.size !== partList.length) {
    throw new Error('部件配置非法：存在重复 id');
  }

  // 静态诊断：缺失依赖引用、依赖成环、永久不可拆下部件。
  const missingRefs = [];
  for (const p of partList) {
    for (const depId of p.deps) {
      if (!byId.has(depId)) missingRefs.push({ part: p.id, missing: depId });
    }
  }

  const cycleNodes = detectCycles(partList, byId);

  // 环上的部件永远拆不下来；沿 deps 继续可达的部件也永远拆不下来
  // （它们仍被环中的依赖方在位阻挡）。
  const unreachableDisassemble = new Set();
  const queue = [...cycleNodes];
  while (queue.length) {
    const id = queue.shift();
    if (unreachableDisassemble.has(id)) continue;
    unreachableDisassemble.add(id);
    for (const depId of byId.get(id).deps) {
      if (byId.has(depId) && !unreachableDisassemble.has(depId)) queue.push(depId);
    }
  }

  // dependentsOf(id) = 依赖 id 的部件（拆下 id 前必须先拆下它们）。
  const dependents = new Map(partIds.map((id) => [id, new Set()]));
  for (const p of partList) {
    for (const depId of p.deps) {
      if (byId.has(depId)) dependents.get(depId).add(p.id);
    }
  }

  const cycleReasonById = buildCycleReasons(partList, byId, cycleNodes);

  // 运行时状态。
  const installed = new Set(partIds); // 初始：所有部件均在位
  const derived = new Map(); // id -> { disassembleStep, reassembleStep }
  let lastHint = { kind: 'info', message: '已就绪：请按依赖关系选择可执行步骤' };
  let stepIndex = 0;

  const labels = (ids) => ids.map((id) => (byId.has(id) ? byId.get(id).label : id));

  function deriveDisassembleStep(id) {
    if (!installed.has(id)) return { status: 'done', reasons: [] };
    if (unreachableDisassemble.has(id)) {
      return { status: 'blocked', reasons: [cycleReasonById.get(id) ?? `部件「${byId.get(id).label}」因依赖成环不可拆下`] };
    }
    const blockers = [...dependents.get(id)].filter((d) => installed.has(d));
    if (blockers.length) {
      return { status: 'blocked', reasons: [`需先拆下：${labels(blockers).join('、')}`] };
    }
    return { status: 'ready', reasons: [] };
  }

  function deriveReassembleStep(id) {
    if (installed.has(id)) return { status: 'done', reasons: [] };
    const missing = byId.get(id).deps.filter((d) => !byId.has(d));
    if (missing.length) {
      return { status: 'blocked', reasons: [`依赖的部件 ${missing.join('、')} 不存在，无法装回`] };
    }
    const notInPlace = byId.get(id).deps.filter((d) => !installed.has(d));
    if (notInPlace.length) {
      return { status: 'blocked', reasons: [`需先装回：${labels(notInPlace).join('、')}`] };
    }
    return { status: 'ready', reasons: [] };
  }

  function deriveOne(id) {
    derived.set(id, { disassembleStep: deriveDisassembleStep(id), reassembleStep: deriveReassembleStep(id) });
  }

  function recomputeAll() {
    for (const id of partIds) deriveOne(id);
  }

  // 仅重推受影响部件：对 X 的操作只会改变 X 自身、X 的依赖方（装回条件）
  // 与 X 的被依赖方（拆下条件）的推导输入。
  function recomputeAffected(targetId) {
    const affected = new Set([targetId]);
    for (const depId of byId.get(targetId).deps) {
      if (byId.has(depId)) affected.add(depId);
    }
    for (const depOfId of dependents.get(targetId)) affected.add(depOfId);
    for (const id of affected) deriveOne(id);
    return affected;
  }

  function progress() {
    const total = partIds.length;
    const removed = total - installed.size;
    let conclusion;
    if (total === 0) conclusion = '未配置任何部件';
    else if (removed === 0) conclusion = '尚未开始拆装';
    else if (removed === total) conclusion = '全部部件已拆下，拆装完成';
    else conclusion = `拆装进行中（已拆下 ${removed}/${total}）`;
    return { removed, total, percent: total ? Math.round((removed / total) * 100) : 0, conclusion };
  }

  function getSnapshot() {
    return {
      parts: partIds.map((id) => ({
        id,
        label: byId.get(id).label,
        installed: installed.has(id),
        disassembleStep: derived.get(id).disassembleStep,
        reassembleStep: derived.get(id).reassembleStep
      })),
      progress: progress(),
      diagnostics: {
        missingRefs: missingRefs.map((r) => ({ part: r.part, missing: r.missing })),
        cycleNodes: [...cycleNodes],
        unreachableDisassemble: [...unreachableDisassemble]
      },
      hint: lastHint
    };
  }

  function applyOp(operation) {
    const kind = operation?.op;
    const id = operation?.part;
    if (!VALID_OPS.has(kind)) {
      lastHint = { kind: 'invalid', message: `未知操作：${String(kind)}，仅支持 disassemble / reassemble` };
      return { applied: false, kind: 'invalid', changed: [], message: lastHint.message };
    }
    if (!byId.has(id)) {
      lastHint = { kind: 'invalid', message: `未知部件：${String(id)}` };
      return { applied: false, kind: 'invalid', changed: [], message: lastHint.message };
    }

    const label = byId.get(id).label;

    if (kind === 'disassemble') {
      if (!installed.has(id)) {
        lastHint = { kind: 'invalid', message: `部件「${label}」已被拆下，重复拆下无效` };
        return { applied: false, kind: 'invalid', changed: [], message: lastHint.message };
      }
      if (unreachableDisassemble.has(id)) {
        const message = cycleReasonById.get(id) ?? `部件「${label}」因依赖成环不可拆下`;
        lastHint = { kind: 'blocked', message };
        return { applied: false, kind: 'blocked', changed: [], message };
      }
      const blockers = [...dependents.get(id)].filter((d) => installed.has(d));
      if (blockers.length) {
        const message = `部件「${label}」暂不可拆下，需先拆下：${labels(blockers).join('、')}`;
        lastHint = { kind: 'blocked', message };
        return { applied: false, kind: 'blocked', changed: [], message };
      }
      installed.delete(id);
      const changed = [...recomputeAffected(id)];
      lastHint = { kind: 'applied', message: `已拆下「${label}」` };
      stepIndex += 1;
      return { applied: true, kind: 'applied', changed, message: lastHint.message, stepIndex };
    }

    // reassemble
    if (installed.has(id)) {
      lastHint = { kind: 'invalid', message: `部件「${label}」已在位，重复装回无效` };
      return { applied: false, kind: 'invalid', changed: [], message: lastHint.message };
    }
    const missing = byId.get(id).deps.filter((d) => !byId.has(d));
    if (missing.length) {
      const message = `部件「${label}」无法装回：依赖的部件 ${missing.join('、')} 不存在`;
      lastHint = { kind: 'blocked', message };
      return { applied: false, kind: 'blocked', changed: [], message };
    }
    const notInPlace = byId.get(id).deps.filter((d) => !installed.has(d));
    if (notInPlace.length) {
      const message = `部件「${label}」暂不可装回，需先装回：${labels(notInPlace).join('、')}`;
      lastHint = { kind: 'blocked', message };
      return { applied: false, kind: 'blocked', changed: [], message };
    }
    installed.add(id);
    const changed = [...recomputeAffected(id)];
    lastHint = { kind: 'applied', message: `已装回「${label}」` };
    stepIndex += 1;
    return { applied: true, kind: 'applied', changed, message: lastHint.message, stepIndex };
  }

  recomputeAll();
  return {
    applyOp,
    getSnapshot,
    recomputeAll,
    getPartIds: () => [...partIds],
    getInstalledIds: () => [...installed].sort()
  };
}

function detectCycles(partList, byId) {
  // 迭代式 DFS：0=未访问 1=在当前栈中 2=已完成，仅沿存在的依赖边。
  const color = new Map(partList.map((p) => [p.id, 0]));
  const onCycle = new Set();
  for (const root of partList.map((p) => p.id)) {
    if (color.get(root) !== 0) continue;
    const stack = [{ id: root, next: 0 }];
    color.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const deps = byId.get(frame.id).deps.filter((d) => byId.has(d));
      if (frame.next < deps.length) {
        const child = deps[frame.next++];
        if (color.get(child) === 0) {
          color.set(child, 1);
          stack.push({ id: child, next: 0 });
        } else if (color.get(child) === 1) {
          onCycle.add(child);
          for (let i = stack.length - 1; stack[i].id !== child && i > 0; i -= 1) onCycle.add(stack[i].id);
        }
      } else {
        color.set(frame.id, 2);
        stack.pop();
      }
    }
  }
  return onCycle;
}

function buildCycleReasons(partList, byId, cycleNodes) {
  const reasons = new Map();
  if (cycleNodes.size === 0) return reasons;
  const cycleText = (startId) => {
    const chain = [startId];
    let cur = startId;
    for (let guard = 0; guard < partList.length + 1; guard += 1) {
      const next = byId.get(cur).deps.find((d) => byId.has(d) && cycleNodes.has(d));
      if (!next) break;
      chain.push(next);
      cur = next;
      if (next === startId) break;
    }
    return chain.map((id) => byId.get(id).label).join(' → ');
  };
  for (const id of cycleNodes) {
    reasons.set(id, `部件「${byId.get(id).label}」处于依赖环（${cycleText(id)}），拆下步骤不可达`);
  }
  // 被环反向波及、但自身不在环上的部件。
  const reach = new Set(cycleNodes);
  const queue = [...cycleNodes];
  while (queue.length) {
    const cur = queue.shift();
    for (const depId of byId.get(cur).deps) {
      if (byId.has(depId) && !reach.has(depId)) {
        reach.add(depId);
        queue.push(depId);
      }
    }
  }
  for (const id of reach) {
    if (reasons.has(id)) continue;
    reasons.set(id, `部件「${byId.get(id).label}」被依赖环波及（环上部件无法先拆下），拆下步骤不可达`);
  }
  return reasons;
}
