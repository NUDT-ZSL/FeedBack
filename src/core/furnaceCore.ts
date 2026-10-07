import { Element, Herb, Pill } from '../types';
import {
  ELEMENT_COLORS,
  ELEMENT_GENERATES,
  ELEMENT_NAMES,
  ELEMENT_OVERCOMES,
  PILL_RECIPES,
  RARITY_NAMES
} from '../constants';
import {
  calculateFlameHeight,
  createPill,
  createWastePill,
  hasGeneratingCombination,
  lerp,
  mixFireColor
} from '../utils';
import {
  AddOperation,
  AddResult,
  BatchOutcome,
  ConflictParty,
  ConflictRecord,
  FurnaceRuntime,
  TraceEvent
} from './types';

export const BASE_FLAME_COLOR = '#e74c3c';
export const EXPLOSION_COOLDOWN_MS = 1500;
export const MAX_TRACE_EVENTS = 200;

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function targetTemperature(airflow: number): number {
  return 20 + airflow * 0.8;
}

export function deriveFlameColor(ingredients: Herb[]): string {
  let color = BASE_FLAME_COLOR;
  for (const herb of ingredients) {
    color = mixFireColor(color, herb.element);
  }
  return color;
}

function toParty(herb: Herb): ConflictParty {
  return { herbId: herb.id, herbName: herb.name, element: herb.element };
}

export function detectConflict(batch: Herb[]): ConflictRecord | null {
  if (batch.length < 2) return null;
  const incoming = batch[batch.length - 1];
  const previous = batch.slice(0, -1);

  const duplicateSources = previous.filter(h => h.element === incoming.element);
  if (duplicateSources.length > 0) {
    const names = [...duplicateSources.map(h => h.name), incoming.name].join('、');
    return {
      kind: 'duplicate',
      element: incoming.element,
      existing: duplicateSources.map(toParty),
      incoming: toParty(incoming),
      reason: `重复投入${ELEMENT_NAMES[incoming.element]}属性药材（${names}），药性重叠对冲`,
      resolution: '判为废丹：本炉清炉，冲突双方药材来源均记录在案'
    };
  }

  const restraintSources = previous.filter(
    h =>
      ELEMENT_OVERCOMES[incoming.element] === h.element ||
      ELEMENT_OVERCOMES[h.element] === incoming.element
  );
  if (restraintSources.length > 0) {
    const first = restraintSources[0];
    const pair =
      ELEMENT_OVERCOMES[incoming.element] === first.element
        ? `${ELEMENT_NAMES[incoming.element]}克${ELEMENT_NAMES[first.element]}`
        : `${ELEMENT_NAMES[first.element]}克${ELEMENT_NAMES[incoming.element]}`;
    return {
      kind: 'restraint',
      element: incoming.element,
      existing: restraintSources.map(toParty),
      incoming: toParty(incoming),
      reason: `${first.name}（${ELEMENT_NAMES[first.element]}）与${incoming.name}（${ELEMENT_NAMES[incoming.element]}）相克：${pair}，炉气逆冲`,
      resolution: '判为炸炉：本炉清炉，冲突双方药材来源均记录在案'
    };
  }

  return null;
}

function generatingPairBasis(elements: Element[]): string[] {
  const basis: string[] = [];
  const unique = [...new Set(elements)];
  for (const a of unique) {
    for (const b of unique) {
      if (a !== b && ELEMENT_GENERATES[a] === b) {
        basis.push(`相生组合：${ELEMENT_NAMES[a]}生${ELEMENT_NAMES[b]}`);
      }
    }
  }
  return basis;
}

function recipeBasis(elements: Element[]): string {
  const elementSet = new Set(elements);
  const match = PILL_RECIPES.find(
    recipe =>
      recipe.elements.length === elementSet.size &&
      recipe.elements.every(el => elementSet.has(el))
  );
  if (match) {
    return `契合丹方「${match.names.join('／')}」（${RARITY_NAMES[match.rarity]}）`;
  }
  return '无既定丹方契合，依药性随机成丹';
}

function makeOutcome(
  batchSeq: number,
  kind: BatchOutcome['kind'],
  pill: Pill | null,
  conflict: ConflictRecord | null,
  basis: string[]
): BatchOutcome {
  return { batchSeq, kind, pill, conflict, basis };
}

export function createFurnaceRuntime(id: string, name: string): FurnaceRuntime {
  return {
    id,
    name,
    operations: [],
    ingredients: [],
    elementSources: {},
    airflow: 50,
    temperature: targetTemperature(50),
    targetTemperature: targetTemperature(50),
    flameColor: BASE_FLAME_COLOR,
    flameHeight: calculateFlameHeight(80, 50, []),
    status: 'pending',
    cooldownUntil: 0,
    lastOutcome: null,
    outcomes: [],
    trace: []
  };
}

export function rebuildFurnace(rt: FurnaceRuntime): void {
  let batch: Herb[] = [];
  let batchAirflow: number[] = [];
  const outcomes: BatchOutcome[] = [];
  const trace: TraceEvent[] = [];

  const pushTrace = (event: TraceEvent) => {
    trace.push(event);
    if (trace.length > MAX_TRACE_EVENTS) trace.shift();
  };

  for (const op of rt.operations) {
    if (op.kind !== 'add') continue;
    batch.push(op.herb);
    batchAirflow.push(op.airflow);
    pushTrace({
      seq: op.seq,
      furnaceId: rt.id,
      type: 'add',
      summary: `投入${herbLabel(op.herb)}`,
      detail: `第${op.seq}手投料：${op.herb.name}（${ELEMENT_NAMES[op.herb.element]}属性），当时风量${Math.round(op.airflow)}`
    });

    const conflict = detectConflict(batch);
    if (conflict) {
      const rng = mulberry32(hashString(rt.id) ^ Math.imul(op.seq, 2654435761));
      const isWaste = conflict.kind === 'duplicate';
      const pill = isWaste
        ? createWastePill(batch, targetTemperature(op.airflow), op.airflow, rng)
        : null;
      if (pill) pill.id = `${rt.id}-b${op.seq}`;
      const basis = [
        `冲突判定：${conflict.reason}`,
        `处置结论：${conflict.resolution}`,
        `涉及药材：${[...conflict.existing.map(p => p.herbName), conflict.incoming.herbName].join('、')}`
      ];
      const outcome = makeOutcome(op.seq, isWaste ? 'waste' : 'explosion', pill, conflict, basis);
      outcomes.push(outcome);
      pushTrace({
        seq: op.seq,
        furnaceId: rt.id,
        type: 'conflict',
        summary: isWaste ? `药性重复，熬成废丹` : `五行相克，炸炉`,
        detail: basis.join('；')
      });
      batch = [];
      batchAirflow = [];
      continue;
    }

    const elements = [...new Set(batch.map(h => h.element))];
    if (batch.length >= 2 && hasGeneratingCombination(elements)) {
      const rng = mulberry32(hashString(rt.id) ^ Math.imul(op.seq, 2654435761));
      const pill = createPill(batch, targetTemperature(op.airflow), op.airflow, rng);
      if (pill) {
        pill.id = `${rt.id}-b${op.seq}`;
        const basis = [
          ...generatingPairBasis(elements),
          recipeBasis(elements),
          `投料${batch.length}味：${batch.map(h => h.name).join('、')}`,
          `成丹时火候：风量${Math.round(op.airflow)}，炉温${Math.round(targetTemperature(op.airflow))}`
        ];
        pill.basis = basis;
        const outcome = makeOutcome(op.seq, 'pill', pill, null, basis);
        outcomes.push(outcome);
        pushTrace({
          seq: op.seq,
          furnaceId: rt.id,
          type: 'outcome',
          summary: `炼成${pill.name}（${RARITY_NAMES[pill.rarity]}）`,
          detail: basis.join('；')
        });
      }
      batch = [];
      batchAirflow = [];
    }
  }

  rt.ingredients = batch;
  const sources: Record<string, string[]> = {};
  for (const herb of batch) {
    if (!sources[herb.element]) sources[herb.element] = [];
    sources[herb.element].push(herb.name);
  }
  rt.elementSources = sources;
  rt.flameColor = deriveFlameColor(batch);
  rt.flameHeight = calculateFlameHeight(80, rt.airflow, [...new Set(batch.map(h => h.element))]);
  rt.targetTemperature = targetTemperature(rt.airflow);
  rt.temperature = rt.targetTemperature;
  rt.outcomes = outcomes;
  rt.lastOutcome = outcomes.length > 0 ? outcomes[outcomes.length - 1] : null;
  rt.status = rt.lastOutcome ? rt.lastOutcome.kind : 'pending';
  rt.trace = trace;
}

function herbLabel(herb: Herb): string {
  return `${herb.name}（${ELEMENT_NAMES[herb.element]}）`;
}

export function addIngredient(rt: FurnaceRuntime, herb: Herb, now: number): AddResult {
  const seq = rt.operations.length + 1;
  const op: AddOperation = { kind: 'add', seq, herb, airflow: rt.airflow };
  rt.operations.push(op);
  const outcomesBefore = rt.outcomes.length;
  rebuildFurnace(rt);
  let outcome: BatchOutcome | null = null;
  if (rt.outcomes.length > outcomesBefore) {
    outcome = rt.outcomes[rt.outcomes.length - 1];
    if (outcome.batchSeq === seq && outcome.kind === 'explosion') {
      rt.cooldownUntil = now + EXPLOSION_COOLDOWN_MS;
    }
  }
  return { accepted: true, outcome };
}

export function undoLastAdd(rt: FurnaceRuntime): AddOperation | null {
  for (let i = rt.operations.length - 1; i >= 0; i--) {
    if (rt.operations[i].kind === 'add') {
      const [removed] = rt.operations.splice(i, 1);
      rebuildFurnace(rt);
      rt.cooldownUntil = 0;
      return removed as AddOperation;
    }
  }
  return null;
}

export function setAirflow(rt: FurnaceRuntime, value: number): void {
  rt.airflow = Math.max(0, Math.min(100, value));
  rt.targetTemperature = targetTemperature(rt.airflow);
  rt.flameHeight = calculateFlameHeight(80, rt.airflow, [
    ...new Set(rt.ingredients.map(h => h.element))
  ]);
}

export function tickFurnace(rt: FurnaceRuntime, dtMs: number, now: number): void {
  const t = 1 - Math.pow(1 - 0.02, dtMs / 16.67);
  rt.temperature = lerp(rt.temperature, rt.targetTemperature, Math.min(1, t));
  if (rt.cooldownUntil > 0 && now >= rt.cooldownUntil) {
    rt.cooldownUntil = 0;
  }
}

export function tickAll(furnaces: FurnaceRuntime[], dtMs: number, now: number): void {
  for (const furnace of furnaces) {
    tickFurnace(furnace, dtMs, now);
  }
}

export function getFurnacePills(rt: FurnaceRuntime): Pill[] {
  return rt.outcomes.filter(o => o.kind === 'pill' && o.pill).map(o => o.pill as Pill);
}

export function elementList(rt: FurnaceRuntime): Element[] {
  return [...new Set(rt.ingredients.map(h => h.element))];
}

export { ELEMENT_COLORS };
