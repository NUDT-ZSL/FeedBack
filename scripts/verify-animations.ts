/**
 * Offline batch verification for the dougong animation engine.
 *
 * Runs scripted operation sequences (disassemble, fly-in, drag-snap,
 * error-rebound, mid-flight mode switches, resets, repeated triggers)
 * against the real store with a manual clock at fixed 16ms steps, then
 * asserts convergence invariants:
 *   - no residual animations (tracks / scheduled callbacks / background)
 *   - every component back to animationPhase 'idle'
 *   - snapped components sit exactly at their correct pose
 *   - isSnapped === isAssembled for every component
 *   - progress matches the snapped main-component count
 *   - mode-transition flags settled
 *   - the whole sequence is reproducible: a second run with the same seed
 *     yields an identical final snapshot
 *
 * Usage: npm run verify
 */
import { useAppStore, animationEngine, setAnimationTimeSource } from '../src/store';
import { setRandomSeed } from '../src/utils/random';
import { isNearTarget, isInErrorZone, calculateDistance } from '../src/utils/helpers';
import { SCENE_CONSTANTS } from '../src/utils/constants';
import { AssemblyMode } from '../src/types';
import type { DougongComponent } from '../src/types';

const STEP_MS = 16;
const EPS = 1e-6;

let now = 0;
setAnimationTimeSource(() => now);

const tick = () => {
  now += STEP_MS;
  useAppStore.getState().advanceAnimations(now);
};

const advance = (ms: number) => {
  const steps = Math.max(1, Math.round(ms / STEP_MS));
  for (let i = 0; i < steps; i++) tick();
};

const settle = (maxMs = 30000) => {
  let elapsed = 0;
  while (animationEngine.hasWork() && elapsed < maxMs) {
    tick();
    elapsed += STEP_MS;
  }
  tick();
};

type Op =
  | { op: 'wait'; ms: number }
  | { op: 'toggleMode' }
  | { op: 'disassemble' }
  | { op: 'flyIn' }
  | { op: 'reset' }
  | { op: 'dragSnap'; id: string }
  | { op: 'dragError'; id: string };

const releaseDrag = (id: string) => {
  const store = useAppStore.getState();
  store.setDragging(null);
  const component = useAppStore.getState().components.find((c) => c.id === id);
  if (!component) throw new Error(`unknown component ${id}`);
  if (isNearTarget(component)) {
    store.snapToTarget(id);
  } else if (isInErrorZone(component)) {
    store.errorSnap(id);
  }
};

const applyOp = (op: Op) => {
  const store = useAppStore.getState();
  switch (op.op) {
    case 'wait':
      advance(op.ms);
      break;
    case 'toggleMode':
      store.toggleMode();
      break;
    case 'disassemble':
      store.disassembleAll();
      break;
    case 'flyIn':
      store.flyInAll();
      break;
    case 'reset':
      store.resetComponents();
      break;
    case 'dragSnap': {
      const target = store.components.find((c) => c.id === op.id);
      if (!target) throw new Error(`unknown component ${op.id}`);
      store.setDragging(op.id);
      store.moveComponent(op.id, {
        x: target.correctPosition.x + SCENE_CONSTANTS.snapThreshold * 0.5,
        y: target.correctPosition.y,
        z: target.correctPosition.z,
      });
      releaseDrag(op.id);
      break;
    }
    case 'dragError': {
      const target = store.components.find((c) => c.id === op.id);
      if (!target) throw new Error(`unknown component ${op.id}`);
      store.setDragging(op.id);
      store.moveComponent(op.id, {
        x: target.correctPosition.x + SCENE_CONSTANTS.errorThreshold + 3,
        y: target.correctPosition.y,
        z: target.correctPosition.z,
      });
      releaseDrag(op.id);
      break;
    }
  }
};

interface ComponentSnapshot {
  id: string;
  phase: DougongComponent['animationPhase'];
  isSnapped: boolean;
  isAssembled: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
}

interface Snapshot {
  components: ComponentSnapshot[];
  progress: number;
  mode: AssemblyMode;
  isModeTransitioning: boolean;
  showFullAssembly: boolean;
  backgroundTransition: number;
  activeTracks: number;
  scheduledCallbacks: number;
  backgroundActive: boolean;
}

const takeSnapshot = (): Snapshot => {
  const state = useAppStore.getState();
  return {
    components: state.components.map((c) => ({
      id: c.id,
      phase: c.animationPhase,
      isSnapped: c.isSnapped,
      isAssembled: c.isAssembled,
      position: [c.position.x, c.position.y, c.position.z],
      rotation: [c.rotation.x, c.rotation.y, c.rotation.z],
    })),
    progress: state.progress,
    mode: state.mode,
    isModeTransitioning: state.isModeTransitioning,
    showFullAssembly: state.showFullAssembly,
    backgroundTransition: state.backgroundTransition,
    activeTracks: animationEngine.activeTrackCount,
    scheduledCallbacks: animationEngine.scheduledCount,
    backgroundActive: animationEngine.hasBackground,
  };
};

const runSequence = (ops: Op[], seed: number): Snapshot => {
  now = 0;
  setRandomSeed(seed);
  useAppStore.getState().resetComponents();
  for (const op of ops) applyOp(op);
  settle();
  return takeSnapshot();
};

const checkInvariants = (name: string, snap: Snapshot): string[] => {
  const failures: string[] = [];
  const state = useAppStore.getState();

  if (snap.activeTracks > 0) failures.push(`${snap.activeTracks} residual animation track(s)`);
  if (snap.scheduledCallbacks > 0) failures.push(`${snap.scheduledCallbacks} residual scheduled callback(s)`);
  if (snap.backgroundActive) failures.push('background transition still active');
  if (snap.isModeTransitioning) failures.push('isModeTransitioning still true');
  if (snap.backgroundTransition !== 0) failures.push(`backgroundTransition=${snap.backgroundTransition}, expected 0`);

  const mainComponents = state.components.filter((c) => c.assemblyOrder <= 12);
  const expectedProgress = Math.round(
    (mainComponents.filter((c) => c.isSnapped).length / mainComponents.length) * 100
  );
  if (snap.progress !== expectedProgress) {
    failures.push(`progress=${snap.progress}, expected ${expectedProgress} from snapped main components`);
  }

  for (const c of state.components) {
    if (c.animationPhase !== 'idle') {
      failures.push(`${c.id}: animationPhase=${c.animationPhase}, expected idle`);
    }
    if (c.isSnapped !== c.isAssembled) {
      failures.push(`${c.id}: isSnapped=${c.isSnapped} but isAssembled=${c.isAssembled}`);
    }
    if (c.isSnapped) {
      const posDist = calculateDistance(c.position, c.correctPosition);
      if (posDist > EPS) {
        failures.push(`${c.id}: snapped but ${posDist.toFixed(6)} away from correctPosition`);
      }
      const rotDist = calculateDistance(c.rotation, c.correctRotation);
      if (rotDist > EPS) {
        failures.push(`${c.id}: snapped but rotation ${rotDist.toFixed(6)} away from correctRotation`);
      }
    }
  }

  return failures.map((f) => `[${name}] ${f}`);
};

type Expectation = (snap: Snapshot) => string[];

const expectAllAtCorrectPose: Expectation = () => {
  const state = useAppStore.getState();
  return state.components
    .filter((c) => calculateDistance(c.position, c.correctPosition) > EPS)
    .map((c) => `${c.id}: expected to land at correctPosition, off by ${calculateDistance(c.position, c.correctPosition).toFixed(6)}`);
};

const expectAllDisassembled: Expectation = (snap) => {
  const state = useAppStore.getState();
  const failures: string[] = [];
  // randomDirection() can yield a near-zero vector, so a scattered component
  // may legitimately land close to home; require the assembly as a whole to
  // be scattered instead of every single component.
  const scattered = state.components.filter(
    (c) => calculateDistance(c.position, c.correctPosition) > 0.5
  ).length;
  if (scattered < state.components.length / 2) {
    failures.push(`only ${scattered}/${state.components.length} components scattered after disassemble`);
  }
  for (const c of state.components) {
    if (c.isSnapped) failures.push(`${c.id}: expected isSnapped=false after disassemble`);
  }
  if (snap.progress !== 0) failures.push(`progress=${snap.progress}, expected 0 after disassemble`);
  return failures;
};

const expectProgress =
  (expected: number): Expectation =>
  (snap) =>
    snap.progress === expected ? [] : [`progress=${snap.progress}, expected ${expected}`];

const expectFullAssembly: Expectation = (snap) =>
  snap.showFullAssembly ? [] : ['showFullAssembly=false, expected true'];

const expectInitialState: Expectation = (snap) => {
  const failures: string[] = [];
  if (snap.mode !== AssemblyMode.Assemble) failures.push(`mode=${snap.mode}, expected Assemble`);
  if (snap.progress !== 100) failures.push(`progress=${snap.progress}, expected 100`);
  failures.push(...expectAllAtCorrectPose(snap));
  return failures;
};

interface Sequence {
  name: string;
  seed: number;
  ops: Op[];
  expect: Expectation[];
}

const MAIN_IDS = [
  'cap-block',
  'nidao-arch',
  'hua-arch-1',
  'qixin-dou-1',
  'san-dou-left-1',
  'san-dou-right-1',
  'hua-arch-2',
  'ling-arch',
  'qixin-dou-2',
  'san-dou-left-2',
  'san-dou-right-2',
  'shua-tou',
];

const sequences: Sequence[] = [
  {
    name: 'disassemble-complete',
    seed: 11,
    ops: [{ op: 'disassemble' }, { op: 'wait', ms: 4000 }],
    expect: [expectAllDisassembled],
  },
  {
    name: 'fly-in-complete',
    seed: 22,
    ops: [{ op: 'disassemble' }, { op: 'wait', ms: 4000 }, { op: 'flyIn' }, { op: 'wait', ms: 6000 }],
    expect: [expectAllAtCorrectPose, expectProgress(0)],
  },
  {
    name: 'toggle-interrupts-disassemble',
    seed: 33,
    ops: [
      { op: 'toggleMode' },
      { op: 'wait', ms: 300 },
      { op: 'toggleMode' },
      { op: 'wait', ms: 8000 },
    ],
    expect: [expectAllAtCorrectPose],
  },
  {
    name: 'toggle-interrupts-fly-in',
    seed: 44,
    ops: [
      { op: 'toggleMode' },
      { op: 'wait', ms: 4000 },
      { op: 'toggleMode' },
      { op: 'wait', ms: 400 },
      { op: 'toggleMode' },
      { op: 'wait', ms: 8000 },
    ],
    expect: [expectAllDisassembled],
  },
  {
    name: 'drag-snap-all',
    seed: 55,
    ops: [
      { op: 'disassemble' },
      { op: 'wait', ms: 4000 },
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      ...MAIN_IDS.flatMap((id): Op[] => [{ op: 'dragSnap', id }, { op: 'wait', ms: 600 }]),
      { op: 'wait', ms: 2000 },
    ],
    expect: [expectProgress(100), expectFullAssembly, expectAllAtCorrectPose],
  },
  {
    name: 'error-rebound',
    seed: 66,
    ops: [
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      { op: 'dragError', id: 'cap-block' },
      { op: 'wait', ms: 2000 },
    ],
    expect: [expectAllAtCorrectPose, expectProgress(0)],
  },
  {
    name: 'error-preempts-snap-then-resnap',
    seed: 77,
    ops: [
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      { op: 'dragSnap', id: 'cap-block' },
      { op: 'wait', ms: 100 },
      { op: 'dragError', id: 'nidao-arch' },
      { op: 'wait', ms: 300 },
      { op: 'dragSnap', id: 'nidao-arch' },
      { op: 'wait', ms: 2000 },
    ],
    expect: [expectProgress(17), expectAllAtCorrectPose],
  },
  {
    name: 'reset-mid-disassemble',
    seed: 88,
    ops: [{ op: 'disassemble' }, { op: 'wait', ms: 300 }, { op: 'reset' }, { op: 'wait', ms: 1000 }],
    expect: [expectInitialState],
  },
  {
    name: 'reset-mid-snap',
    seed: 99,
    ops: [
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      { op: 'dragSnap', id: 'cap-block' },
      { op: 'wait', ms: 100 },
      { op: 'reset' },
      { op: 'wait', ms: 1000 },
    ],
    expect: [expectInitialState],
  },
  {
    name: 'repeated-disassemble',
    seed: 111,
    ops: [
      { op: 'disassemble' },
      { op: 'wait', ms: 120 },
      { op: 'disassemble' },
      { op: 'wait', ms: 120 },
      { op: 'disassemble' },
      { op: 'wait', ms: 4000 },
    ],
    expect: [expectAllDisassembled],
  },
  {
    name: 'repeated-snap-same-component',
    seed: 122,
    ops: [
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      { op: 'dragSnap', id: 'cap-block' },
      { op: 'wait', ms: 150 },
      { op: 'dragSnap', id: 'cap-block' },
      { op: 'wait', ms: 2000 },
    ],
    expect: [expectProgress(8)],
  },
  {
    name: 'toggle-mode-spam',
    seed: 133,
    ops: [
      { op: 'toggleMode' },
      { op: 'wait', ms: 50 },
      { op: 'toggleMode' },
      { op: 'wait', ms: 50 },
      { op: 'toggleMode' },
      { op: 'wait', ms: 8000 },
    ],
    expect: [expectAllDisassembled],
  },
  {
    name: 'fly-in-interrupts-disassemble-then-snap',
    seed: 144,
    ops: [
      { op: 'disassemble' },
      { op: 'wait', ms: 200 },
      { op: 'flyIn' },
      { op: 'wait', ms: 6000 },
      { op: 'dragSnap', id: 'shua-tou' },
      { op: 'wait', ms: 2000 },
    ],
    expect: [expectProgress(8), expectAllAtCorrectPose],
  },
];

let totalFailures = 0;

for (const seq of sequences) {
  const first = runSequence(seq.ops, seq.seed);

  const failures: string[] = [];
  failures.push(...checkInvariants(seq.name, first));
  for (const expect of seq.expect) {
    failures.push(...expect(first).map((f) => `[${seq.name}] ${f}`));
  }

  const second = runSequence(seq.ops, seq.seed);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push(`[${seq.name}] non-deterministic: two runs with seed ${seq.seed} diverged`);
  }

  const snappedCount = first.components.filter(
    (c) => c.isSnapped && MAIN_IDS.includes(c.id)
  ).length;

  if (failures.length === 0) {
    console.log(
      `PASS ${seq.name}  (mode=${first.mode}, progress=${first.progress}, snapped=${snappedCount}/${MAIN_IDS.length}, residualTracks=${first.activeTracks})`
    );
  } else {
    totalFailures += failures.length;
    console.log(`FAIL ${seq.name}`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log('  final state:', JSON.stringify(first, null, 2));
  }
}

console.log(
  totalFailures === 0
    ? `\nAll ${sequences.length} sequences passed.`
    : `\n${totalFailures} failure(s) across ${sequences.length} sequences.`
);

process.exit(totalFailures === 0 ? 0 : 1);
