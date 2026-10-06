/**
 * 离线批量验证：斗拱拆装动画收敛机制。
 *
 * 在固定时间步（16ms）下推进一组操作序列，每组序列独立跑两遍：
 *  - 校验终态自洽（位置/旋转/animationPhase/isSnapped/isAssembled/progress）
 *  - 校验不存在残留动画
 *  - 校验两遍结果完全一致（稳定可复现）
 *
 * 运行：npm run verify:animations
 */
import { useAppStore } from '../src/store';
import { AssemblyMode } from '../src/types';
import type { Transform } from '../src/types';
import { isNearTarget, isInErrorZone, calculateDistance } from '../src/utils/helpers';

const STEP_MS = 16;
const EPS = 1e-9;

interface SequenceOp {
  at: number;
  label: string;
  run: () => void;
}

interface SoundEvent {
  t: number;
  type: string;
}

interface SequenceContext {
  sounds: SoundEvent[];
}

interface SequenceSpec {
  name: string;
  horizonMs: number;
  ops: SequenceOp[];
  expect?: (snapshot: StateSnapshot, ctx: SequenceContext) => string[];
}

interface ComponentSnapshot {
  id: string;
  position: Transform;
  rotation: Transform;
  animationPhase: string | undefined;
  isSnapped: boolean;
  isAssembled: boolean;
  isAnimating: boolean | undefined;
}

interface StateSnapshot {
  mode: AssemblyMode;
  progress: number;
  isModeTransitioning: boolean;
  showFullAssembly: boolean;
  backgroundTransition: number;
  activeAnimations: number;
  components: ComponentSnapshot[];
}

const store = () => useAppStore.getState();

const takeSnapshot = (): StateSnapshot => {
  const s = store();
  return {
    mode: s.mode,
    progress: s.progress,
    isModeTransitioning: s.isModeTransitioning,
    showFullAssembly: s.showFullAssembly,
    backgroundTransition: s.backgroundTransition,
    activeAnimations: s.getActiveAnimationCount(),
    components: s.components.map((c) => ({
      id: c.id,
      position: { ...c.position },
      rotation: { ...c.rotation },
      animationPhase: c.animationPhase,
      isSnapped: c.isSnapped,
      isAssembled: c.isAssembled,
      isAnimating: c.isAnimating,
    })),
  };
};

const drainSounds = (t: number, log: SoundEvent[]) => {
  const s = store();
  for (const item of s.soundQueue) {
    log.push({ t, type: item.type });
  }
  if (s.soundQueue.length > 0) {
    useAppStore.setState({ soundQueue: [] });
  }
};

const runSequenceOnce = (spec: SequenceSpec): { snapshot: StateSnapshot; ctx: SequenceContext } => {
  store().resetComponents();
  useAppStore.setState({ soundQueue: [] });

  const ctx: SequenceContext = { sounds: [] };
  const pending = spec.ops.map((op) => ({ ...op, done: false }));

  for (let t = 0; t <= spec.horizonMs; t += STEP_MS) {
    for (const op of pending) {
      if (!op.done && op.at <= t) {
        op.done = true;
        op.run();
      }
    }
    drainSounds(t, ctx.sounds);
    store().tickAnimations(STEP_MS);
    drainSounds(t, ctx.sounds);
  }

  return { snapshot: takeSnapshot(), ctx };
};

const checkInvariants = (snap: StateSnapshot): string[] => {
  const failures: string[] = [];

  if (snap.activeAnimations !== 0) {
    failures.push(`残留动画未收敛: activeAnimations=${snap.activeAnimations}`);
  }

  const mainComponents = snap.components;
  const snappedCount = mainComponents.filter((c) => c.isSnapped).length;
  const expectedProgress = Math.round((snappedCount / mainComponents.length) * 100);
  if (snap.progress !== expectedProgress) {
    failures.push(`progress=${snap.progress} 与已吸附主构件数 ${snappedCount}/${mainComponents.length} 不一致(期望 ${expectedProgress})`);
  }

  for (const c of snap.components) {
    const correct = store().components.find((x) => x.id === c.id)!;
    if (c.animationPhase !== 'idle') {
      failures.push(`${c.id}: animationPhase=${c.animationPhase} 未回到 idle`);
    }
    if (c.isAnimating) {
      failures.push(`${c.id}: isAnimating 仍为 true`);
    }
    if (c.isSnapped !== c.isAssembled) {
      failures.push(`${c.id}: isSnapped=${c.isSnapped} 与 isAssembled=${c.isAssembled} 不一致`);
    }
    if (c.isSnapped) {
      const dist = calculateDistance(c.position, correct.correctPosition);
      if (dist > EPS) {
        failures.push(`${c.id}: 已吸附但位置偏离正确位 ${dist}`);
      }
      const rotDist = calculateDistance(c.rotation, correct.correctRotation);
      if (rotDist > EPS) {
        failures.push(`${c.id}: 已吸附但旋转偏离正确值 ${rotDist}`);
      }
    }
  }

  return failures;
};

const fmtVec = (v: Transform) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

const printSnapshot = (snap: StateSnapshot) => {
  console.log(
    `  终态: mode=${snap.mode} progress=${snap.progress} activeAnimations=${snap.activeAnimations} ` +
      `isModeTransitioning=${snap.isModeTransitioning} showFullAssembly=${snap.showFullAssembly} ` +
      `backgroundTransition=${snap.backgroundTransition}`
  );
  for (const c of snap.components) {
    console.log(
      `    ${c.id.padEnd(16)} phase=${String(c.animationPhase).padEnd(6)} snapped=${c.isSnapped} assembled=${c.isAssembled} pos=${fmtVec(c.position)} rot=${fmtVec(c.rotation)}`
    );
  }
};

// 模拟 useDrag 的 pointerup 判定逻辑（触发距离口径与拖拽钩子一致）
const simulateDragDrop = (id: string, dropPosition: Transform) => {
  store().moveComponent(id, dropPosition);
  const component = store().components.find((c) => c.id === id)!;
  if (isNearTarget(component)) {
    store().snapToTarget(id);
  } else if (isInErrorZone(component)) {
    store().errorSnap(id);
  }
};

const nearCorrectDrop = (id: string): Transform => {
  const c = store().components.find((x) => x.id === id)!;
  return {
    x: c.correctPosition.x + 0.4,
    y: c.correctPosition.y + 0.3,
    z: c.correctPosition.z + 0.2,
  };
};

const countSounds = (ctx: SequenceContext, type: string) =>
  ctx.sounds.filter((s) => s.type === type).length;

const expectAllDisassembled = (snap: StateSnapshot): string[] => {
  const failures: string[] = [];
  for (const c of snap.components) {
    if (c.isSnapped) failures.push(`${c.id}: 期望未吸附`);
    const correct = store().components.find((x) => x.id === c.id)!;
    if (calculateDistance(c.position, correct.correctPosition) < 0.1) {
      failures.push(`${c.id}: 期望被拆散但仍停留在正确位`);
    }
  }
  if (snap.progress !== 0) failures.push(`期望 progress=0, 实际 ${snap.progress}`);
  return failures;
};

const expectAllAssembled = (snap: StateSnapshot): string[] => {
  const failures: string[] = [];
  for (const c of snap.components) {
    if (!c.isSnapped) failures.push(`${c.id}: 期望已吸附`);
  }
  if (snap.progress !== 100) failures.push(`期望 progress=100, 实际 ${snap.progress}`);
  return failures;
};

const sequences: SequenceSpec[] = [
  {
    name: 'disassemble-complete 整体拆解至结束',
    horizonMs: 2500,
    ops: [{ at: 0, label: 'disassembleAll', run: () => store().disassembleAll() }],
    expect: (snap, ctx) => [
      ...expectAllDisassembled(snap),
      ...(countSounds(ctx, 'friction') === 12
        ? []
        : [`期望 12 次 friction 音效, 实际 ${countSounds(ctx, 'friction')}`]),
    ],
  },
  {
    name: 'fly-in-complete 拆解后整体飞入',
    horizonMs: 5000,
    ops: [
      { at: 0, label: 'disassembleAll', run: () => store().disassembleAll() },
      { at: 2000, label: 'flyInAll', run: () => store().flyInAll() },
    ],
    expect: (snap) => expectAllAssembled(snap),
  },
  {
    name: 'toggle-mid-disassemble 拆解中途切回组装',
    horizonMs: 5000,
    ops: [
      { at: 0, label: 'toggleMode->Disassemble', run: () => store().toggleMode() },
      { at: 400, label: 'toggleMode->Assemble', run: () => store().toggleMode() },
    ],
    expect: (snap) => [
      ...expectAllAssembled(snap),
      ...(snap.mode === AssemblyMode.Assemble ? [] : [`期望 mode=Assemble, 实际 ${snap.mode}`]),
      ...(snap.isModeTransitioning ? ['isModeTransitioning 未复位'] : []),
      ...(snap.backgroundTransition === 0 ? [] : [`backgroundTransition 未归零: ${snap.backgroundTransition}`]),
    ],
  },
  {
    name: 'rapid-toggles 连续快速切换模式',
    horizonMs: 4500,
    ops: [
      { at: 0, label: 'toggle#1', run: () => store().toggleMode() },
      { at: 250, label: 'toggle#2', run: () => store().toggleMode() },
      { at: 500, label: 'toggle#3', run: () => store().toggleMode() },
    ],
    expect: (snap) => [
      ...expectAllDisassembled(snap),
      ...(snap.mode === AssemblyMode.Disassemble ? [] : [`期望 mode=Disassemble, 实际 ${snap.mode}`]),
      ...(snap.isModeTransitioning ? ['isModeTransitioning 未复位'] : []),
    ],
  },
  {
    name: 'drag-snap-near 拖拽吸附',
    horizonMs: 4000,
    ops: [
      { at: 0, label: 'disassembleAll', run: () => store().disassembleAll() },
      { at: 2000, label: 'dragDrop cap-block near', run: () => simulateDragDrop('cap-block', nearCorrectDrop('cap-block')) },
    ],
    expect: (snap, ctx) => {
      const cap = snap.components.find((c) => c.id === 'cap-block')!;
      return [
        ...(cap.isSnapped ? [] : ['cap-block: 期望已吸附']),
        ...(snap.progress === 8 ? [] : [`期望 progress=8, 实际 ${snap.progress}`]),
        ...(countSounds(ctx, 'snap') === 1 ? [] : [`期望 1 次 snap 音效, 实际 ${countSounds(ctx, 'snap')}`]),
        ...(snap.showFullAssembly ? ['未全部吸附不应 showFullAssembly'] : []),
      ];
    },
  },
  {
    name: 'error-snap-far 错误回弹',
    horizonMs: 4000,
    ops: [
      { at: 0, label: 'disassembleAll', run: () => store().disassembleAll() },
      { at: 2000, label: 'dragDrop nidao-arch far', run: () => simulateDragDrop('nidao-arch', { x: 30, y: 28, z: 0 }) },
    ],
    expect: (snap, ctx) => {
      const target = snap.components.find((c) => c.id === 'nidao-arch')!;
      return [
        ...(target.isSnapped ? [] : ['nidao-arch: 回弹后期望已吸附落位']),
        ...(snap.progress === 8 ? [] : [`期望 progress=8, 实际 ${snap.progress}`]),
        ...(countSounds(ctx, 'error') === 1 ? [] : [`期望 1 次 error 音效, 实际 ${countSounds(ctx, 'error')}`]),
      ];
    },
  },
  {
    name: 'snap-interrupted-by-disassemble 吸附被拆解打断',
    horizonMs: 5000,
    ops: [
      { at: 0, label: 'disassembleAll', run: () => store().disassembleAll() },
      { at: 2000, label: 'snap cap-block', run: () => simulateDragDrop('cap-block', nearCorrectDrop('cap-block')) },
      { at: 2200, label: 'disassembleAll again', run: () => store().disassembleAll() },
    ],
    expect: (snap) => expectAllDisassembled(snap),
  },
  {
    name: 'repeat-same-animation 重复触发同一动画',
    horizonMs: 6500,
    ops: [
      { at: 0, label: 'disassembleAll#1', run: () => store().disassembleAll() },
      { at: 150, label: 'disassembleAll#2', run: () => store().disassembleAll() },
      { at: 2000, label: 'flyInAll#1', run: () => store().flyInAll() },
      { at: 2200, label: 'flyInAll#2', run: () => store().flyInAll() },
    ],
    expect: (snap) => expectAllAssembled(snap),
  },
  {
    name: 'reset-mid-animation 重置中断动画',
    horizonMs: 2500,
    ops: [
      { at: 0, label: 'toggleMode->Disassemble', run: () => store().toggleMode() },
      { at: 400, label: 'resetComponents', run: () => store().resetComponents() },
    ],
    expect: (snap) => [
      ...expectAllAssembled(snap),
      ...(snap.mode === AssemblyMode.Assemble ? [] : [`期望 mode=Assemble, 实际 ${snap.mode}`]),
      ...(snap.backgroundTransition === 0 ? [] : [`backgroundTransition 未归零: ${snap.backgroundTransition}`]),
    ],
  },
  {
    name: 'snap-all-full-assembly 全部吸附触发整体展示',
    horizonMs: 5000,
    ops: [
      { at: 0, label: 'disassembleAll', run: () => store().disassembleAll() },
      {
        at: 2000,
        label: 'snap all 12',
        run: () => {
          for (const c of store().components) {
            simulateDragDrop(c.id, nearCorrectDrop(c.id));
          }
        },
      },
    ],
    expect: (snap) => [
      ...expectAllAssembled(snap),
      ...(snap.showFullAssembly ? [] : ['全部吸附后期望 showFullAssembly=true']),
    ],
  },
];

let failedSequences = 0;

for (const spec of sequences) {
  const first = runSequenceOnce(spec);
  const second = runSequenceOnce(spec);

  const failures: string[] = [];
  failures.push(...checkInvariants(first.snapshot).map((f) => `[自洽性] ${f}`));

  if (JSON.stringify(first.snapshot) !== JSON.stringify(second.snapshot)) {
    failures.push('[可复现] 同一序列两遍终态不一致');
  }

  if (spec.expect) {
    failures.push(...spec.expect(first.snapshot, first.ctx).map((f) => `[期望] ${f}`));
  }

  const passed = failures.length === 0;
  if (!passed) failedSequences += 1;

  console.log(`${passed ? 'PASS' : 'FAIL'}  ${spec.name}`);
  printSnapshot(first.snapshot);
  console.log(`  音效: ${first.ctx.sounds.map((s) => `${s.type}@${s.t}ms`).join(', ') || '(无)'}`);
  for (const f of failures) {
    console.log(`  失败项: ${f}`);
  }
  console.log('');
}

console.log(`共 ${sequences.length} 组序列, 通过 ${sequences.length - failedSequences}, 失败 ${failedSequences}`);
process.exit(failedSequences === 0 ? 0 : 1);
