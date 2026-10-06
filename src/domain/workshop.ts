import type { MaterialCost, Order, Pattern, WorkshopState } from './types.ts';
import { MetalType, OrderStatus } from './types.ts';
import { WorkshopError } from './errors.ts';
import { cloneState, nextId, patternContentKey, validateMaterials } from './support.ts';

export interface SagaStep {
  name: string;
  apply: (state: WorkshopState) => void;
}

export interface SynthesizeResult {
  pattern: Pattern;
  deduplicated: boolean;
}

export const STEP_SUBMIT_PATTERN = 'submit-pattern';
export const STEP_DEDUCT_INVENTORY = 'deduct-inventory';
export const STEP_TRANSITION_ORDER = 'transition-order';

export class Workshop {
  private state: WorkshopState;
  private readonly undoStack: WorkshopState[] = [];
  private failingStep: string | null = null;

  constructor(seed: WorkshopState) {
    this.state = cloneState(seed);
  }

  snapshot(): WorkshopState {
    return cloneState(this.state);
  }

  get inventory(): Readonly<Record<MetalType, number>> {
    return { ...this.state.inventory };
  }

  get patterns(): readonly Pattern[] {
    return this.state.patterns.map((pattern) => structuredClone(pattern));
  }

  get orders(): readonly Order[] {
    return this.state.orders.map((order) => structuredClone(order));
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  failNextStep(stepName: string): void {
    this.failingStep = stepName;
  }

  private runSaga(steps: readonly SagaStep[]): void {
    const before = cloneState(this.state);
    this.undoStack.push(before);
    try {
      for (const step of steps) {
        if (this.failingStep === step.name) {
          this.failingStep = null;
          throw new WorkshopError('STEP_FAILED', `步骤「${step.name}」执行失败`, step.name);
        }
        step.apply(this.state);
      }
    } catch (error) {
      this.state = before;
      this.undoStack.pop();
      throw error;
    }
  }

  synthesizePattern(name: string, materials: MaterialCost[]): SynthesizeResult {
    validateMaterials(materials);
    const contentKey = patternContentKey(name, materials);
    const existingId = this.state.patternsByKey[contentKey];
    if (existingId !== undefined) {
      const existing = this.state.patterns.find((pattern) => pattern.id === existingId);
      if (existing !== undefined) {
        return { pattern: structuredClone(existing), deduplicated: true };
      }
    }

    this.runSaga([
      {
        name: STEP_SUBMIT_PATTERN,
        apply: (state) => {
          const pattern: Pattern = {
            id: nextId('pattern'),
            name,
            materials: structuredClone(materials),
            contentKey,
            status: 'submitted',
            createdAt: Date.now(),
          };
          state.patterns.push(pattern);
          state.patternsByKey[contentKey] = pattern.id;
        },
      },
      {
        name: STEP_DEDUCT_INVENTORY,
        apply: (state) => {
          for (const cost of materials) {
            const remaining = state.inventory[cost.metal];
            if (remaining === undefined) {
              throw new WorkshopError('UNKNOWN_METAL', `库存中不存在金属: ${cost.metal}`);
            }
            if (remaining < cost.amount) {
              throw new WorkshopError(
                'INSUFFICIENT_STOCK',
                `金属 ${cost.metal} 库存不足: 需要 ${cost.amount}, 剩余 ${remaining}`,
              );
            }
          }
          for (const cost of materials) {
            state.inventory[cost.metal] -= cost.amount;
          }
        },
      },
    ]);

    const createdId = this.state.patternsByKey[contentKey];
    const created = this.state.patterns.find((pattern) => pattern.id === createdId);
    return { pattern: structuredClone(created!), deduplicated: false };
  }

  transitionOrderToCrafting(orderId: string): Order {
    const order = this.state.orders.find((item) => item.id === orderId);
    if (order === undefined) {
      throw new WorkshopError('ORDER_NOT_FOUND', `订单不存在: ${orderId}`);
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new WorkshopError(
        'INVALID_ORDER_TRANSITION',
        `订单 ${orderId} 当前状态为 ${order.status}, 不能流转到 crafting`,
      );
    }

    const costs = order.materials;
    this.runSaga([
      {
        name: STEP_DEDUCT_INVENTORY,
        apply: (state) => {
          for (const cost of costs) {
            const remaining = state.inventory[cost.metal];
            if (remaining === undefined) {
              throw new WorkshopError('UNKNOWN_METAL', `库存中不存在金属: ${cost.metal}`);
            }
            if (remaining < cost.amount) {
              throw new WorkshopError(
                'INSUFFICIENT_STOCK',
                `金属 ${cost.metal} 库存不足: 需要 ${cost.amount}, 剩余 ${remaining}`,
              );
            }
          }
          for (const cost of costs) {
            state.inventory[cost.metal] -= cost.amount;
          }
        },
      },
      {
        name: STEP_TRANSITION_ORDER,
        apply: (state) => {
          const target = state.orders.find((item) => item.id === orderId);
          if (target === undefined) {
            throw new WorkshopError('ORDER_NOT_FOUND', `订单不存在: ${orderId}`);
          }
          target.status = OrderStatus.CRAFTING;
        },
      },
    ]);

    return structuredClone(this.state.orders.find((item) => item.id === orderId)!);
  }

  undo(): WorkshopState {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      throw new WorkshopError('NOTHING_TO_UNDO', '没有可撤销的操作');
    }
    this.state = previous;
    return this.snapshot();
  }
}
