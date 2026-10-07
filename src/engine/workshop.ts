import type { Element, Herb, Pill } from '../types.ts';
import {
  ELEMENT_NAMES,
  ELEMENT_OVERCOMES,
  EFFECT_NAMES,
  RARITY_NAMES
} from '../constants.ts';
import type {
  AddResult,
  ConflictRecord,
  DropOutcome,
  FurnaceEvent,
  FurnaceState,
  IngredientRecord,
  PillVerdict,
  Rng
} from './model.ts';
import {
  BASE_FLAME_COLOR,
  DEFAULT_AIRFLOW,
  DEFAULT_TEMPERATURE
} from './model.ts';
import {
  conflictActiveKeys,
  createPillWithRng,
  deriveElements,
  deriveFlameColor,
  deriveFlameHeight,
  describeRestraint,
  getGeneratingPairs,
  hasGeneratingCombination,
  noVerdict,
  resolveStatus
} from './derive.ts';

export const MAX_FURNACES = 6;

const FURNACE_ORDINALS = ['一', '二', '三', '四', '五', '六'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class AlchemyWorkshop {
  private furnaces: FurnaceState[] = [];
  private selectedId: string | null = null;
  private elapsedMs = 0;
  private furnaceCounter = 0;
  private readonly rng: Rng;

  constructor(rng: Rng = Math.random) {
    this.rng = rng;
  }

  addFurnace(name?: string): FurnaceState {
    if (this.furnaces.length >= MAX_FURNACES) {
      throw new Error(`炼丹台最多同时开 ${MAX_FURNACES} 炉`);
    }
    const ordinal = this.furnaceCounter + 1;
    const furnace: FurnaceState = {
      id: `furnace-${ordinal}`,
      name: name ?? `${FURNACE_ORDINALS[ordinal - 1]}号丹炉`,
      ingredients: [],
      airflow: DEFAULT_AIRFLOW,
      temperature: DEFAULT_TEMPERATURE,
      flameColor: BASE_FLAME_COLOR,
      flameHeight: 120,
      elements: [],
      status: 'idle',
      activeConflicts: [],
      conflictHistory: [],
      verdict: noVerdict([]),
      log: [],
      undoStack: []
    };
    this.furnaceCounter += 1;
    this.furnaces.push(furnace);
    if (this.selectedId === null) this.selectedId = furnace.id;
    this.writeLog(furnace, 'add', `开炉「${furnace.name}」，初始风量 ${DEFAULT_AIRFLOW}、炉温 ${DEFAULT_TEMPERATURE}。`);
    return furnace;
  }

  getFurnaces(): readonly FurnaceState[] {
    return this.furnaces;
  }

  getFurnace(id: string): FurnaceState {
    const furnace = this.furnaces.find((item) => item.id === id);
    if (!furnace) throw new Error(`未找到丹炉：${id}`);
    return furnace;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  getSelectedFurnace(): FurnaceState | null {
    return this.selectedId ? this.getFurnace(this.selectedId) : null;
  }

  selectFurnace(id: string): FurnaceState {
    this.getFurnace(id);
    this.selectedId = id;
    return this.getFurnace(id);
  }

  setAirflow(id: string, value: number): FurnaceState {
    const furnace = this.getFurnace(id);
    furnace.airflow = clamp(Math.round(value), 0, 100);
    furnace.flameHeight = deriveFlameHeight(furnace.airflow, furnace.ingredients);
    this.writeLog(furnace, 'airflow', `拉动风箱，进风量调至 ${furnace.airflow}（仅作用于本炉）。`);
    return furnace;
  }

  addIngredient(id: string, herb: Herb): AddResult {
    const furnace = this.getFurnace(id);
    furnace.undoStack.push({
      ingredients: [...furnace.ingredients],
      temperature: furnace.temperature,
      verdict: furnace.verdict
    });

    const record: IngredientRecord = {
      seq: furnace.ingredients.length + 1,
      herb,
      addedAtTick: this.elapsedMs
    };
    furnace.ingredients.push(record);

    const newConflicts = this.detectConflictsAgainstFurnace(furnace, record);
    this.recompute(furnace);

    this.writeLog(
      furnace,
      'add',
      `投料第 ${record.seq} 味：${herb.name}（${ELEMENT_NAMES[herb.element]}性）入炉。`
    );
    for (const conflict of newConflicts) {
      this.writeLog(furnace, 'conflict', `${conflict.reason} 处置：${conflict.resolution === 'explode' ? '炸炉' : '废丹'}。`);
    }
    this.writeLog(furnace, 'verdict', `成丹判定：${furnace.verdict.reason}`);

    return {
      furnaceId: furnace.id,
      record,
      conflicts: newConflicts,
      verdict: furnace.verdict
    };
  }

  undoLastIngredient(id: string): { furnace: FurnaceState; removed: IngredientRecord | null } {
    const furnace = this.getFurnace(id);
    const snapshot = furnace.undoStack.pop();
    if (!snapshot) {
      return { furnace, removed: null };
    }
    const removed = furnace.ingredients[furnace.ingredients.length - 1] ?? null;
    furnace.ingredients = [...snapshot.ingredients];
    furnace.temperature = snapshot.temperature;
    const restoredVerdict = snapshot.verdict;
    this.recompute(furnace);
    furnace.verdict = restoredVerdict;

    const removedName = removed ? `第 ${removed.seq} 味「${removed.herb.name}」` : '上一味药材';
    this.writeLog(
      furnace,
      'undo',
      `回退 ${removedName}：元素集合、火焰颜色与炉温均恢复至投料前状态。`
    );
    this.writeLog(furnace, 'verdict', `成丹判定重推：${furnace.verdict.reason}`);
    return { furnace, removed };
  }

  clearFurnace(id: string): FurnaceState {
    const furnace = this.getFurnace(id);
    furnace.ingredients = [];
    furnace.undoStack = [];
    furnace.conflictHistory = [];
    this.recompute(furnace);
    this.writeLog(furnace, 'clear', '清理炉膛：投料记录清空，冲突备案归档，火候复原。');
    return furnace;
  }

  tick(deltaMs: number): void {
    this.elapsedMs += Math.max(0, deltaMs);
    for (const furnace of this.furnaces) {
      const targetTemperature = 20 + furnace.airflow * 0.8;
      const frameSteps = Math.max(0, deltaMs) / 16.67;
      const blend = 1 - Math.pow(0.98, frameSteps);
      furnace.temperature += (targetTemperature - furnace.temperature) * blend;
    }
  }

  toDropOutcome(furnaceId: string): DropOutcome {
    const furnace = this.getFurnace(furnaceId);
    return {
      outcome: furnace.verdict.outcome,
      pill: furnace.verdict.pill,
      reason: furnace.verdict.reason,
      elements: [...furnace.elements]
    };
  }

  private detectConflictsAgainstFurnace(
    furnace: FurnaceState,
    incoming: IngredientRecord
  ): ConflictRecord[] {
    const conflicts: ConflictRecord[] = [];
    for (const existing of furnace.ingredients) {
      if (existing.seq === incoming.seq) continue;
      const incomingElement = incoming.herb.element;
      const existingElement = existing.herb.element;

      if (existingElement === incomingElement) {
        conflicts.push({
          id: `${furnace.id}:conflict:${existing.seq}-${incoming.seq}`,
          kind: 'duplicate',
          element: incomingElement,
          otherElement: null,
          existing,
          incoming,
          resolution: 'waste',
          reason:
            `药性重复：新投「${incoming.herb.name}」与炉中第 ${existing.seq} 味「${existing.herb.name}」` +
            `同属${ELEMENT_NAMES[incomingElement]}性，双方来源均予保留。`,
          active: true
        });
      } else if (
        ELEMENT_OVERCOMES[existingElement] === incomingElement ||
        ELEMENT_OVERCOMES[incomingElement] === existingElement
      ) {
        conflicts.push({
          id: `${furnace.id}:conflict:${existing.seq}-${incoming.seq}`,
          kind: 'restrain',
          element: incomingElement,
          otherElement: existingElement,
          existing,
          incoming,
          resolution: 'explode',
          reason:
            `五行相克：新投「${incoming.herb.name}」(${ELEMENT_NAMES[incomingElement]})与炉中第 ${existing.seq} 味` +
            `「${existing.herb.name}」(${ELEMENT_NAMES[existingElement]})互为克制（${describeRestraint(
              existingElement,
              incomingElement
            )}），双方来源均予保留。`,
          active: true
        });
      }
    }
    furnace.conflictHistory.push(...conflicts);
    return conflicts;
  }

  private evaluate(furnace: FurnaceState): PillVerdict {
    const activeRestraints = furnace.activeConflicts.filter(
      (conflict) => conflict.kind === 'restrain'
    );
    const activeDuplicates = furnace.activeConflicts.filter(
      (conflict) => conflict.kind === 'duplicate'
    );

    if (activeRestraints.length > 0) {
      const basis = activeRestraints.map((conflict) => conflict.reason);
      if (activeDuplicates.length > 0) {
        basis.push(...activeDuplicates.map((conflict) => conflict.reason));
      }
      return {
        outcome: 'explode',
        pill: null,
        reason: '相克药材同炉，火气逆冲——炸炉，丹毁炉伤；回退或清理后方可再炼。',
        basis
      };
    }

    if (activeDuplicates.length > 0) {
      return {
        outcome: 'waste',
        pill: null,
        reason: '同属性药材重复淤积，相生之机被掩——废丹，不予成丹。',
        basis: activeDuplicates.map((conflict) => conflict.reason)
      };
    }

    if (furnace.ingredients.length >= 2 && hasGeneratingCombination(furnace.elements)) {
      const pillId = `pill@${furnace.id}:${furnace.ingredients
        .map((record) => record.herb.id)
        .join('+')}`;
      const pill: Pill | null = createPillWithRng(
        pillId,
        furnace.ingredients.map((record) => record.herb),
        furnace.temperature,
        furnace.airflow,
        this.rng
      );
      if (pill) {
        const pairText = getGeneratingPairs(furnace.elements)
          .map(([from, to]) => `${ELEMENT_NAMES[from]}生${ELEMENT_NAMES[to]}`)
          .join('、');
        const rarityName = RARITY_NAMES[pill.rarity];
        const effectName = EFFECT_NAMES[pill.effect] ?? pill.effect;
        return {
          outcome: 'pill',
          pill,
          reason: `相生之势（${pairText}）已成，炼成「${pill.name}」（${rarityName}），功效：${effectName}。`,
          basis: [
            `相生判定：${pairText}`,
            `药材来源：${pill.ingredients.join('、')}`,
            `火候记录：炉温 ${pill.fireTemp}℃ / 风量 ${pill.airFlow}`,
            `五行集合：${pill.elements.map((element) => ELEMENT_NAMES[element]).join('、')}`,
            `丹品：${rarityName}`
          ]
        };
      }
    }

    return noVerdict(furnace.ingredients);
  }

  private recompute(furnace: FurnaceState): void {
    furnace.elements = deriveElements(furnace.ingredients);
    furnace.flameColor = deriveFlameColor(furnace.ingredients);
    furnace.flameHeight = deriveFlameHeight(furnace.airflow, furnace.ingredients);

    const activeKeys = conflictActiveKeys(furnace.ingredients);
    for (const conflict of furnace.conflictHistory) {
      conflict.active = activeKeys.has(`${conflict.existing.seq}:${conflict.incoming.seq}`);
    }
    furnace.activeConflicts = furnace.conflictHistory.filter((conflict) => conflict.active);
    furnace.status = resolveStatus(furnace.ingredients, furnace.activeConflicts);
    furnace.verdict = this.evaluate(furnace);
  }

  private writeLog(
    furnace: FurnaceState,
    type: FurnaceEvent['type'],
    message: string
  ): void {
    furnace.log.push({
      seq: furnace.log.length + 1,
      type,
      message,
      atTick: this.elapsedMs
    });
  }
}
