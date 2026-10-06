/**
 * 离线验收脚本：不启动界面即可验证排产与工时推演链路。
 *
 * 验收点：
 *  1. 同一批输入从"界面入口"和"直接调用入口"得到一致结果；
 *  2. 结果与输入数组的遍历顺序无关、重复运行一致；
 *  3. 参数修正后局部重算与整体重算一致，且只重算受影响范围；
 *  4. 冲突无法裁决时双方保留且依据可追溯；
 *  5. 工时推算符合织机工作历。
 *
 * 运行：npm run schedule:verify
 */
import {
  applyRevision,
  canonicalize,
  isoToMinute,
  minuteToIso,
  recomputeViaService,
  recomputeViaUi,
  runSchedule,
  runScheduleViaService,
  runScheduleViaUi,
  sampleInput,
} from '../src/scheduling/index';
import type {
  ScheduleInput,
  ScheduleResult,
  ScheduleRevision,
  ScheduledSegment,
  WorkCalendar,
} from '../src/scheduling/index';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✓' : '✗';
  if (!ok) failures += 1;
  console.log(`  ${mark} ${name}${detail ? ` —— ${detail}` : ''}`);
}

/** 可观察结果投影：占用顺序、起止、完成时刻、冲突裁决（不含来源标记）。 */
function observable(result: ScheduleResult) {
  const stripPinned = (segment: ScheduledSegment): Omit<ScheduledSegment, 'pinned'> => {
    const copy = { ...segment };
    delete copy.pinned;
    return copy;
  };
  return {
    segments: result.segments.map(stripPinned),
    orderCompletions: result.orderCompletions,
    conflicts: result.conflicts,
  };
}
function sameObservable(a: ScheduleResult, b: ScheduleResult): boolean {
  return canonicalize(observable(a)) === canonicalize(observable(b));
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], rand: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 独立实现的"时段内工作分钟数"，用于交叉验证工时推算。 */
function workMinutesBetween(calendar: WorkCalendar, from: number, to: number): number {
  let total = 0;
  let cursor = from;
  for (let guard = 0; guard < 100000 && cursor < to - 1e-9; guard += 1) {
    const local = cursor + calendar.timezoneOffsetMinutes;
    const dayIndex = Math.floor(local / 1440);
    const minuteOfDay = local - dayIndex * 1440;
    const dayOfWeek = (((dayIndex + 4) % 7) + 7) % 7;
    const windows = calendar.days[dayOfWeek] ?? [];
    const window = windows.find((w) => w.endMinute > minuteOfDay);
    if (!window) {
      cursor = (dayIndex + 1) * 1440 - calendar.timezoneOffsetMinutes;
      continue;
    }
    if (minuteOfDay < window.startMinute) {
      cursor = dayIndex * 1440 + window.startMinute - calendar.timezoneOffsetMinutes;
      continue;
    }
    const segmentEnd = Math.min(to, dayIndex * 1440 + window.endMinute - calendar.timezoneOffsetMinutes);
    total += segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return total;
}

console.log('— 1. 双入口一致性（界面入口 vs 直接调用入口）—');
const viaUi = runScheduleViaUi(sampleInput);
const viaService = runScheduleViaService(sampleInput);
check('结果摘要一致', viaUi.meta.resultDigest === viaService.meta.resultDigest,
  `ui=${viaUi.meta.resultDigest} service=${viaService.meta.resultDigest}`);
check('织机占用顺序/完成时刻/冲突裁决逐项一致', sameObservable(viaUi, viaService));
check('输入哈希一致', viaUi.meta.inputHash === viaService.meta.inputHash,
  `inputHash=${viaUi.meta.inputHash}`);

console.log('— 2. 确定性与遍历顺序无关 —');
const rand = mulberry32(20261007);
let orderIndependent = true;
for (let i = 0; i < 20; i += 1) {
  const shuffledInput: ScheduleInput = {
    horizonStart: sampleInput.horizonStart,
    looms: shuffled(sampleInput.looms, rand),
    orders: shuffled(sampleInput.orders, rand),
    operations: shuffled(sampleInput.operations, rand),
  };
  const result = runScheduleViaService(shuffledInput);
  if (result.meta.resultDigest !== viaService.meta.resultDigest) {
    orderIndependent = false;
    break;
  }
}
check('20 组随机打乱输入顺序，结果摘要全部一致', orderIndependent);
check('重复运行结果一致', runScheduleViaService(sampleInput).meta.resultDigest === viaService.meta.resultDigest);

console.log('— 3. 参数修正：局部重算与整体重算一致 —');
const revisions: Array<[string, ScheduleRevision, boolean]> = [
  ['织机效率修正 L3: 1.15→0.90', { loomEfficiency: { L3: 0.9 } }, true],
  ['工序工时修正 O3-C: 600→900', { operationWorkMinutes: { 'O3-C': 900 } }, true],
  // 优先级修正的影响面从该订单可开工时刻起即可能改变裁决，退化为自起点重算是正确行为。
  ['订单优先级修正 O3: 2→0（影响面触及起点）', { orderPriority: { O3: 0 } }, false],
  ['工序候选织机修正 O1-C += L3', { operationLoomIds: { 'O1-C': ['L1', 'L3'] } }, true],
  // L3 自推演起点起就是候选织机，其工作历修正的影响面覆盖全程。
  ['织机工作历修正 L3→标准历（影响面触及起点）', { loomCalendar: { L3: sampleInput.looms[0].calendar } }, false],
  ['交期修正 O4 提前一天', { orderDueAt: { O4: '2026-10-13T16:00:00.000Z' } }, true],
  ['组合修正 L3 效率 1.3 + O2-B 工时 480', {
    loomEfficiency: { L3: 1.3 },
    operationWorkMinutes: { 'O2-B': 480 },
  }, true],
  // L2 从推演起点起就被占用，其效率修正的影响面天然覆盖全程，退化为整体重算是正确行为。
  ['织机效率修正 L2: 0.85→1.30（影响面覆盖全程）', { loomEfficiency: { L2: 1.3 } }, false],
];
for (const [name, revision, expectPartial] of revisions) {
  const incremental = recomputeViaService(sampleInput, revision, viaService);
  const full = runScheduleViaService(applyRevision(sampleInput, revision));
  const consistent = sameObservable(incremental.result, full);
  const horizon = isoToMinute(sampleInput.horizonStart);
  const partial = incremental.affected.fromMinute > horizon;
  check(`${name}：局部==整体`, consistent,
    `重算界=${incremental.affected.fromAt} 影响订单=${incremental.affected.orderIds.join(',') || '无'}`);
  check(`${name}：重算范围符合预期`, partial === expectPartial,
    partial ? `从 ${incremental.affected.fromAt} 起重算，此前决定冻结` : '影响面触及推演起点，整体重算');
}

console.log('— 3b. 随机修正模糊验证（30 组）—');
{
  const fuzzRand = mulberry32(987654);
  const loomIds = sampleInput.looms.map((loom) => loom.id);
  const opIds = sampleInput.operations.map((operation) => operation.id);
  const orderIds = sampleInput.orders.map((order) => order.id);
  let fuzzOk = true;
  let fuzzPartial = 0;
  for (let i = 0; i < 30; i += 1) {
    const revision: ScheduleRevision = {};
    if (fuzzRand() < 0.5) {
      revision.loomEfficiency = {
        [loomIds[Math.floor(fuzzRand() * loomIds.length)]]: 0.6 + fuzzRand(),
      };
    }
    if (fuzzRand() < 0.5) {
      revision.operationWorkMinutes = {
        [opIds[Math.floor(fuzzRand() * opIds.length)]]: 60 + Math.floor(fuzzRand() * 720),
      };
    }
    if (fuzzRand() < 0.3) {
      revision.orderPriority = {
        [orderIds[Math.floor(fuzzRand() * orderIds.length)]]: Math.floor(fuzzRand() * 4),
      };
    }
    if (fuzzRand() < 0.3) {
      revision.operationLoomIds = {
        [opIds[Math.floor(fuzzRand() * opIds.length)]]: shuffled(loomIds, fuzzRand).slice(0, 1 + Math.floor(fuzzRand() * 2)),
      };
    }
    const incremental = recomputeViaUi(sampleInput, revision, viaUi);
    const full = runScheduleViaUi(applyRevision(sampleInput, revision));
    if (!sameObservable(incremental.result, full)) {
      fuzzOk = false;
      console.log('    不一致的修正:', JSON.stringify(revision));
      break;
    }
    if (incremental.affected.fromMinute > isoToMinute(sampleInput.horizonStart)) fuzzPartial += 1;
  }
  check('30 组随机修正：局部重算均与整体重算一致', fuzzOk, `其中 ${fuzzPartial}/30 组为局部重算`);
}

console.log('— 4. 冲突无法裁决时保留双方并可追溯 —');
{
  const first = viaService.segments.find((s) => s.loomId === 'L1')!;
  const second = viaService.segments.find((s) => s.loomId === 'L1' && s.operationId !== first.operationId)!;
  // 人为制造两张互相重叠的钉单（如两张急单被同时钉上同一台织机）。
  const pinned: ScheduledSegment[] = [
    { ...first, pinned: true },
    { ...second, startMinute: first.startMinute + 60, endMinute: first.startMinute + 60 + (second.endMinute - second.startMinute), pinned: true,
      startAt: minuteToIso(first.startMinute + 60),
      endAt: minuteToIso(first.startMinute + 60 + (second.endMinute - second.startMinute)) },
  ];
  const conflicted = runSchedule(sampleInput, { mode: 'incremental', pinned });
  const record = conflicted.conflicts.find((c) => c.reason === 'pinned-overlap');
  check('产生 pinned-overlap 冲突记录', !!record);
  check('冲突双方均保留在时间轴上',
    !!record &&
      conflicted.segments.some((s) => s.operationId === first.operationId && s.pinned) &&
      conflicted.segments.some((s) => s.operationId === second.operationId && s.pinned),
    record ? `双方=${record.operationIds.join('、')}` : '');
  check('冲突依据可追溯（规则/证据/轨迹）',
    !!record &&
      typeof record.adjudication === 'string' && record.adjudication.length > 0 &&
      !!record.evidence &&
      conflicted.traces.some((t) => t.kind === 'conflict' && t.operationId === second.operationId));
}
{
  const deadlockInput: ScheduleInput = {
    ...sampleInput,
    operations: [
      ...sampleInput.operations,
      { id: 'OX-A', orderId: 'O1', sequence: 9, name: '循环依赖工序', loomIds: ['L1'], workMinutes: 60, dependsOn: ['OX-A'] },
    ],
  };
  const deadlocked = runScheduleViaService(deadlockInput);
  check('依赖成环不静默丢弃：保留为未排并留证',
    deadlocked.conflicts.some((c) => c.reason === 'dependency-deadlock' && c.operationIds.includes('OX-A')) &&
    deadlocked.orderCompletions.find((c) => c.orderId === 'O1')?.completionMinute === null);
}

console.log('— 5. 工时推算符合织机工作历 —');
{
  const loomsById = new Map(sampleInput.looms.map((loom) => [loom.id, loom]));
  const opsById = new Map(sampleInput.operations.map((operation) => [operation.id, operation]));
  let calendarOk = true;
  for (const segment of viaService.segments) {
    const loom = loomsById.get(segment.loomId)!;
    const operation = opsById.get(segment.operationId)!;
    const expected = operation.workMinutes / loom.efficiency;
    const actual = workMinutesBetween(loom.calendar, segment.startMinute, segment.endMinute);
    if (Math.abs(actual - expected) > 0.01) {
      calendarOk = false;
      console.log(`    工时不符: ${segment.operationId} 期望 ${expected} 实际 ${actual}`);
      break;
    }
  }
  check('每段占用的工作分钟数 = 标准工时 / 织机效率（按工作历折算）', calendarOk);
  const adjudications = viaService.traces.filter((t) => t.kind === 'adjudicate');
  check('同刻竞争均产生裁决轨迹', adjudications.length > 0,
    `${adjudications.length} 条裁决记录，示例规则：${adjudications[0]?.rule ?? '无'}`);
}

console.log('');
if (failures > 0) {
  console.error(`验收未通过：${failures} 项失败`);
  process.exit(1);
}
console.log(`全部验收通过。样例输入哈希 ${viaService.meta.inputHash}，结果摘要 ${viaService.meta.resultDigest}`);
console.log('订单完成时刻：');
for (const completion of viaService.orderCompletions) {
  console.log(`  ${completion.orderId}: ${completion.completionAt ?? '未排产'}`);
}
