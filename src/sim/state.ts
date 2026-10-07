import type {
  BambooStrip,
  Candle,
  CraftPhase,
  HangingState,
  Node,
  SilkColor,
  SilkPanel,
} from '../types.ts';

export interface StateOp {
  seq: number;
  kind: string;
  detail: string;
}

export interface SimState {
  phase: CraftPhase;
  nodes: Node[];
  bambooStrips: BambooStrip[];
  silkPanels: SilkPanel[];
  candle: Candle;
  hanging: HangingState;
  selectedColor: SilkColor;
  history: StateOp[];
}

export const TENSION_MIN = 0;
export const TENSION_MAX = 100;
export const PROGRESS_MIN = 0;
export const PROGRESS_MAX = 100;

const SWING_DAMPING = 1.5;
const SWING_ANGULAR_FREQ = 2 * Math.PI * 0.8;

export function createInitialState(): SimState {
  const nodes: Node[] = [
    { id: 'n1', x: 0, y: 1, z: 0, isDragging: false },
    { id: 'n2', x: -1, y: 0, z: 0, isDragging: false },
    { id: 'n3', x: 1, y: 0, z: 0, isDragging: false },
    { id: 'n4', x: 0, y: -1, z: 0, isDragging: false },
  ];
  const bambooStrips: BambooStrip[] = [
    { id: 's1', startNodeId: 'n1', endNodeId: 'n2', isConnected: true, highlighted: false },
    { id: 's2', startNodeId: 'n1', endNodeId: 'n3', isConnected: true, highlighted: false },
    { id: 's3', startNodeId: 'n2', endNodeId: 'n4', isConnected: true, highlighted: false },
    { id: 's4', startNodeId: 'n3', endNodeId: 'n4', isConnected: true, highlighted: false },
  ];
  const silkPanels: SilkPanel[] = [
    { id: 'p1', nodeIds: ['n1', 'n2', 'n3'], color: 'moonWhite', pastingProgress: 0, tension: 0, isDetached: false },
    { id: 'p2', nodeIds: ['n2', 'n3', 'n4'], color: 'moonWhite', pastingProgress: 0, tension: 0, isDetached: false },
  ];
  const candle: Candle = { isLit: false, brightness: 0, flickerOffset: 0, flameHeight: 0 };
  const hanging: HangingState = { isHanging: false, swingAngle: 0, swingVelocity: 0, hookId: '' };
  return {
    phase: 'skeleton',
    nodes,
    bambooStrips,
    silkPanels,
    candle,
    hanging,
    selectedColor: 'moonWhite',
    history: [],
  };
}

function record(state: SimState, kind: string, detail: string): SimState {
  const op: StateOp = { seq: state.history.length + 1, kind, detail };
  return { ...state, history: [...state.history, op] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function setPhase(state: SimState, phase: CraftPhase): SimState {
  return record({ ...state, phase }, 'set-phase', `phase=${phase}`);
}

export function dragNodeBy(state: SimState, nodeId: string, dx: number, dy: number, dz: number): SimState {
  const target = state.nodes.find((node) => node.id === nodeId);
  if (!target) {
    return record(state, 'drag-node-missing', `nodeId=${nodeId} dx=${dx} dy=${dy} dz=${dz} (ignored)`);
  }
  const before = { x: target.x, y: target.y, z: target.z };
  const nodes = state.nodes.map((node) =>
    node.id === nodeId
      ? { ...node, x: node.x + dx, y: node.y + dy, z: node.z + dz, isDragging: true }
      : node,
  );
  return record(
    { ...state, nodes },
    'drag-node',
    `nodeId=${nodeId} delta=(${dx},${dy},${dz}) ${before.x},${before.y},${before.z} -> ${target.x + dx},${target.y + dy},${target.z + dz}`,
  );
}

export function pastePanel(state: SimState, panelId: string, progressDelta: number, tensionDelta: number): SimState {
  const panel = state.silkPanels.find((item) => item.id === panelId);
  if (!panel) {
    return record(state, 'paste-panel-missing', `panelId=${panelId} (ignored)`);
  }
  if (panel.isDetached) {
    return record(state, 'paste-panel-rejected', `panelId=${panelId} isDetached=true (ignored)`);
  }
  const progress = clamp(panel.pastingProgress + progressDelta, PROGRESS_MIN, PROGRESS_MAX);
  const tension = clamp(panel.tension + tensionDelta, TENSION_MIN, TENSION_MAX);
  const silkPanels = state.silkPanels.map((item) =>
    item.id === panelId ? { ...item, pastingProgress: progress, tension } : item,
  );
  return record(
    { ...state, silkPanels },
    'paste-panel',
    `panelId=${panelId} delta=(progress:${progressDelta},tension:${tensionDelta}) -> progress=${progress} tension=${tension}`,
  );
}

export function setSilkColor(state: SimState, panelId: string, color: SilkColor): SimState {
  const exists = state.silkPanels.some((panel) => panel.id === panelId);
  if (!exists) {
    return record(state, 'set-color-missing', `panelId=${panelId} color=${color} (ignored)`);
  }
  const silkPanels = state.silkPanels.map((panel) =>
    panel.id === panelId ? { ...panel, color } : panel,
  );
  return record({ ...state, silkPanels, selectedColor: color }, 'set-color', `panelId=${panelId} color=${color}`);
}

export function addBambooStrip(state: SimState, id: string, startNodeId: string, endNodeId: string): SimState {
  const strip: BambooStrip = { id, startNodeId, endNodeId, isConnected: true, highlighted: false };
  return record(
    { ...state, bambooStrips: [...state.bambooStrips, strip] },
    'add-strip',
    `stripId=${id} ${startNodeId} -> ${endNodeId}`,
  );
}

export function detachPanel(state: SimState, panelId: string): SimState {
  const exists = state.silkPanels.some((panel) => panel.id === panelId);
  if (!exists) {
    return record(state, 'detach-panel-missing', `panelId=${panelId} (ignored)`);
  }
  const silkPanels = state.silkPanels.map((panel) =>
    panel.id === panelId ? { ...panel, isDetached: true } : panel,
  );
  return record({ ...state, silkPanels }, 'detach-panel', `panelId=${panelId}`);
}

export function lightCandle(state: SimState): SimState {
  return record({ ...state, candle: { ...state.candle, isLit: true } }, 'light-candle', 'isLit=true');
}

export function kickCandle(state: SimState, flickerDelta: number): SimState {
  const candle: Candle = { ...state.candle, flickerOffset: state.candle.flickerOffset + flickerDelta };
  return record({ ...state, candle }, 'kick-candle', `flickerOffset += ${flickerDelta}`);
}

export function hangLantern(state: SimState, hookId: string, initialAngle = 15): SimState {
  const hanging: HangingState = { isHanging: true, swingAngle: initialAngle, swingVelocity: 0, hookId };
  return record({ ...state, hanging }, 'hang-lantern', `hookId=${hookId} initialAngle=${initialAngle}`);
}

export function nudgeSwing(state: SimState, angleDelta: number): SimState {
  if (!state.hanging.isHanging) {
    return record(state, 'nudge-swing-rejected', `isHanging=false (ignored)`);
  }
  const hanging: HangingState = {
    ...state.hanging,
    swingAngle: state.hanging.swingAngle + angleDelta,
  };
  return record({ ...state, hanging }, 'nudge-swing', `swingAngle += ${angleDelta}`);
}

export function tickCandle(state: SimState, dt: number): SimState {
  const target = state.candle.isLit ? 1 : 0;
  const k = Math.min(1, 4 * dt);
  const brightness = state.candle.brightness + (target - state.candle.brightness) * k;
  const flickerOffset = state.candle.flickerOffset * Math.exp(-2 * dt);
  const candle: Candle = {
    ...state.candle,
    brightness,
    flickerOffset,
    flameHeight: state.candle.isLit ? 1 + flickerOffset : 0,
  };
  return { ...state, candle };
}

export function tickSwing(state: SimState, dt: number): SimState {
  if (!state.hanging.isHanging) {
    return state;
  }
  const { swingAngle, swingVelocity } = state.hanging;
  const acceleration = -(SWING_ANGULAR_FREQ ** 2) * swingAngle - 2 * SWING_DAMPING * swingVelocity;
  const swingVelocityNext = swingVelocity + acceleration * dt;
  const swingAngleNext = swingAngle + swingVelocityNext * dt;
  return {
    ...state,
    hanging: { ...state.hanging, swingAngle: swingAngleNext, swingVelocity: swingVelocityNext },
  };
}
