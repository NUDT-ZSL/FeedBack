import type { SimState } from './state.ts';
import {
  addBambooStrip,
  createInitialState,
  detachPanel,
  dragNodeBy,
  hangLantern,
  kickCandle,
  lightCandle,
  nudgeSwing,
  pastePanel,
  setPhase,
  setSilkColor,
} from './state.ts';
import { analyzeSkeleton, deriveDisplay, simulateCandle, simulateSwing } from './derive.ts';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  trace?: string[];
}

export interface Scenario {
  id: string;
  title: string;
  run(): CheckResult[];
}

const approx = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

const fmt = (n: number): string => Number(n.toFixed(6)).toString();

function historyTrace(state: SimState, kind?: string): string[] {
  return state.history
    .filter((op) => !kind || op.kind === kind)
    .map((op) => `#${op.seq} ${op.kind}: ${op.detail}`);
}

function repeatedNodeDrag(): Scenario {
  return {
    id: 'accumulate-node-drag',
    title: '同一节点反复拖动：位移按增量累积而非覆盖',
    run() {
      let state = createInitialState();
      const deltas: Array<[number, number, number]> = [
        [0.1, 0, 0],
        [0.2, -0.1, 0],
        [-0.05, 0.05, 0.1],
        [0, 0, -0.1],
        [0.15, 0.15, 0],
      ];
      for (const [dx, dy, dz] of deltas) {
        state = dragNodeBy(state, 'n1', dx, dy, dz);
      }
      const node = state.nodes.find((n) => n.id === 'n1')!;
      const sum = deltas.reduce((acc, d) => [acc[0] + d[0], acc[1] + d[1], acc[2] + d[2]], [0, 0, 0]);
      const expected = { x: 0 + sum[0], y: 1 + sum[1], z: 0 + sum[2] };
      const pass =
        approx(node.x, expected.x) && approx(node.y, expected.y) && approx(node.z, expected.z);
      const othersUntouched = state.nodes
        .filter((n) => n.id !== 'n1')
        .every((n) => approx(n.x, createInitialState().nodes.find((m) => m.id === n.id)!.x));
      const dragOps = state.history.filter((op) => op.kind === 'drag-node');
      return [
        {
          name: 'position-accumulates',
          pass,
          detail: `expected (${fmt(expected.x)},${fmt(expected.y)},${fmt(expected.z)}), got (${fmt(node.x)},${fmt(node.y)},${fmt(node.z)})`,
          trace: historyTrace(state, 'drag-node'),
        },
        {
          name: 'drag-history-complete',
          pass: dragOps.length === deltas.length,
          detail: `expected ${deltas.length} drag ops in history, got ${dragOps.length}`,
        },
        {
          name: 'other-nodes-untouched',
          pass: othersUntouched,
          detail: othersUntouched ? 'n2/n3/n4 unchanged' : 'unexpected side effect on other nodes',
        },
      ];
    },
  };
}

function repeatedPanelPasting(): Scenario {
  return {
    id: 'accumulate-panel-pasting',
    title: '同一绸面反复裱糊：进度与张力累积并正确封顶',
    run() {
      let state = createInitialState();
      state = setPhase(state, 'pasting');
      state = setSilkColor(state, 'p1', 'begoniaRed');
      for (let i = 0; i < 5; i++) {
        state = pastePanel(state, 'p1', 25, 10);
      }
      const panel = state.silkPanels.find((p) => p.id === 'p1')!;
      const other = state.silkPanels.find((p) => p.id === 'p2')!;
      return [
        {
          name: 'progress-accumulates-and-clamps',
          pass: approx(panel.pastingProgress, 100),
          detail: `5 x +25 -> progress=${panel.pastingProgress} (overwrite would yield 25, unclamped sum 125 clamps to 100)`,
          trace: historyTrace(state, 'paste-panel'),
        },
        {
          name: 'tension-accumulates',
          pass: approx(panel.tension, 50),
          detail: `5 x +10 -> tension=${panel.tension} (overwrite would yield 10)`,
        },
        {
          name: 'color-switch-preserved',
          pass: panel.color === 'begoniaRed' && state.selectedColor === 'begoniaRed',
          detail: `panel color=${panel.color}, selectedColor=${state.selectedColor}`,
        },
        {
          name: 'sibling-panel-untouched',
          pass: approx(other.pastingProgress, 0) && approx(other.tension, 0),
          detail: `p2 progress=${other.pastingProgress} tension=${other.tension}`,
        },
      ];
    },
  };
}

function missingNodeReference(): Scenario {
  return {
    id: 'missing-node-reference',
    title: '竹条指向缺失节点：推演给出可追溯结论而非静默跳过',
    run() {
      let state = createInitialState();
      state = addBambooStrip(state, 's5', 'n1', 'ghost-node');
      state = addBambooStrip(state, 's6', 'void-a', 'void-b');
      const report = analyzeSkeleton(state);
      const findings = report.findings.filter((f) => f.kind === 'missing-node');
      const s5Finding = findings.find((f) => f.kind === 'missing-node' && f.stripId === 's5');
      const s6Findings = findings.filter((f) => f.kind === 'missing-node' && f.stripId === 's6');
      return [
        {
          name: 'missing-endpoint-reported',
          pass: findings.length === 3 && !!s5Finding && s6Findings.length === 2,
          detail: `findings=${findings.length} (s5:1, s6:2)`,
          trace: findings.map((f) =>
            f.kind === 'missing-node' ? `strip ${f.stripId} ${f.endpoint} -> missing node "${f.missingNodeId}"` : '',
          ),
        },
        {
          name: 'valid-strips-still-counted',
          pass: report.validStrips.length === 4 && report.totalStrips === 6,
          detail: `valid=${report.validStrips.length}/${report.totalStrips} (s1..s4 remain valid)`,
        },
        {
          name: 'report-not-ok',
          pass: !report.ok,
          detail: `ok=${report.ok}`,
        },
      ];
    },
  };
}

function cyclicConnection(): Scenario {
  return {
    id: 'cyclic-connection',
    title: '连接关系成环：推演报告环路径',
    run() {
      const tree: SimState = {
        ...createInitialState(),
        bambooStrips: [
          { id: 't1', startNodeId: 'n1', endNodeId: 'n2', isConnected: true, highlighted: false },
          { id: 't2', startNodeId: 'n1', endNodeId: 'n3', isConnected: true, highlighted: false },
          { id: 't3', startNodeId: 'n2', endNodeId: 'n4', isConnected: true, highlighted: false },
        ],
      };
      const state = addBambooStrip(tree, 't4', 'n2', 'n3');
      const report = analyzeSkeleton(state);
      const cycles = report.findings.filter((f) => f.kind === 'cycle');
      const clean = analyzeSkeleton(tree);
      const closedLoop = cycles.every((c) => c.kind === 'cycle' && c.path[0] === c.path[c.path.length - 1]);
      return [
        {
          name: 'single-cycle-detected-with-path',
          pass: cycles.length === 1 && closedLoop,
          detail: `cycles=${cycles.length}, every path is a closed loop`,
          trace: cycles.map((c) => (c.kind === 'cycle' ? `cycle path: ${c.path.join(' -> ')}` : '')),
        },
        {
          name: 'acyclic-skeleton-clean',
          pass: clean.ok && clean.findings.length === 0,
          detail: `tree skeleton findings=${clean.findings.length}`,
        },
      ];
    },
  };
}

function detachPropagation(): Scenario {
  return {
    id: 'detach-propagation',
    title: '绸面脱离后：依赖节点与相邻绸面的展示结论随之更新',
    run() {
      let state = createInitialState();
      state = setPhase(state, 'display');
      const before = deriveDisplay(state);
      state = detachPanel(state, 'p1');
      const after = deriveDisplay(state);

      const p1 = after.panels.find((p) => p.panelId === 'p1')!;
      const p2 = after.panels.find((p) => p.panelId === 'p2')!;
      const n1 = after.nodes.find((n) => n.nodeId === 'n1')!;
      const n2 = after.nodes.find((n) => n.nodeId === 'n2')!;
      const beforeAllIntact = before.panels.every((p) => p.verdict === 'intact')
        && before.nodes.every((n) => n.status === 'supported');

      return [
        {
          name: 'baseline-all-intact',
          pass: beforeAllIntact,
          detail: 'before detach: every panel intact, every node supported',
        },
        {
          name: 'detached-panel-hidden',
          pass: p1.verdict === 'hidden-detached',
          detail: `p1 verdict=${p1.verdict}`,
          trace: p1.reasons,
        },
        {
          name: 'neighbor-panel-affected',
          pass: p2.verdict === 'affected-neighbor',
          detail: `p2 verdict=${p2.verdict}`,
          trace: p2.reasons,
        },
        {
          name: 'dependent-node-unsupported',
          pass: n1.status === 'unsupported',
          detail: `n1 status=${n1.status} (only referenced by detached p1)`,
          trace: n1.reasons,
        },
        {
          name: 'shared-node-still-supported',
          pass: n2.status === 'supported',
          detail: `n2 status=${n2.status} (still held by intact p2)`,
          trace: n2.reasons,
        },
      ];
    },
  };
}

function candleConvergence(): Scenario {
  return {
    id: 'candle-convergence',
    title: '烛火亮度：连续多次状态变更后收敛到稳定值',
    run() {
      let state = createInitialState();
      state = setPhase(state, 'assembly');
      state = lightCandle(state);
      state = kickCandle(state, 0.4);
      state = kickCandle(state, -0.2);
      state = kickCandle(state, 0.1);
      const result = simulateCandle(state, 1 / 60, 600, 1e-3);
      return [
        {
          name: 'brightness-converges',
          pass: result.converged && approx(result.finalValue, 1, 1e-3),
          detail: `final brightness=${fmt(result.finalValue)} target=1 settledAtStep=${result.settledAtStep}/${result.steps}`,
        },
        {
          name: 'flicker-dies-out',
          pass: Math.abs(result.finalFlicker) < 1e-3,
          detail: `final flickerOffset=${fmt(result.finalFlicker)} after 3 kicks`,
        },
      ];
    },
  };
}

function swingConvergence(): Scenario {
  return {
    id: 'swing-convergence',
    title: '悬挂摆动：连续扰动后阻尼收敛到静止',
    run() {
      let state = createInitialState();
      state = setPhase(state, 'hanging');
      state = hangLantern(state, 'hook-1');
      state = nudgeSwing(state, 5);
      state = nudgeSwing(state, -3);
      state = nudgeSwing(state, 2);
      const result = simulateSwing(state, 1 / 60, 600, 1e-2);
      return [
        {
          name: 'swing-converges',
          pass: result.converged,
          detail: `settledAtStep=${result.settledAtStep}/${result.steps}`,
        },
        {
          name: 'angle-and-velocity-rest',
          pass: Math.abs(result.finalValue) < 1e-2 && Math.abs(result.finalVelocity) < 1e-2,
          detail: `final angle=${fmt(result.finalValue)}deg velocity=${fmt(result.finalVelocity)}`,
        },
      ];
    },
  };
}

export const scenarios: Scenario[] = [
  repeatedNodeDrag(),
  repeatedPanelPasting(),
  missingNodeReference(),
  cyclicConnection(),
  detachPropagation(),
  candleConvergence(),
  swingConvergence(),
];
