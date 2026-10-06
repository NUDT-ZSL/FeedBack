import { InventoryStore } from './inventory.ts';
import { UndoHistory } from './history.ts';
import { InjectedFault, WorkshopError } from './types.ts';
import type {
  FailurePoint,
  MaterialCost,
  Order,
  OrderStatus,
  PatternRecord,
  Stock,
} from './types.ts';

export interface SubmitPatternInput {
  idempotencyKey: string;
  name: string;
  recipe: MaterialCost[];
}

export interface SubmitPatternResult {
  record: PatternRecord;
  deduplicated: boolean;
}

export interface StepOptions {
  failAt?: FailurePoint;
}

export class Workshop {
  readonly inventory: InventoryStore;
  readonly history: UndoHistory = new UndoHistory();

  protected patterns: Map<string, PatternRecord> = new Map();
  protected submissions: Map<string, string> = new Map();
  protected orders: Map<string, Order> = new Map();
  private patternSeq = 0;

  constructor(initialStock: Partial<Stock> = {}) {
    this.inventory = new InventoryStore(initialStock);
  }

  submitPattern(input: SubmitPatternInput, options: StepOptions = {}): SubmitPatternResult {
    this.validateRecipe(input.recipe);
    const duplicate = this.submissions.get(input.idempotencyKey);
    if (duplicate !== undefined) {
      return { record: this.requirePattern(duplicate), deduplicated: true };
    }
    if (!this.inventory.canAfford(input.recipe)) {
      throw new WorkshopError(`insufficient stock for pattern "${input.name}"`);
    }

    const compensations: Array<() => void> = [];
    try {
      this.inventory.deduct(input.recipe);
      compensations.push(() => this.inventory.restore(input.recipe));

      this.injectFault(options.failAt, 'pattern.afterInventoryDeducted');

      const record: PatternRecord = {
        id: `pattern-${++this.patternSeq}`,
        name: input.name,
        recipe: input.recipe.map((c) => ({ ...c })),
        status: 'submitted',
        seq: this.patternSeq,
      };
      this.patterns.set(record.id, record);
      this.submissions.set(input.idempotencyKey, record.id);
      this.history.push({
        kind: 'pattern.submit',
        label: record.name,
        undo: () => {
          this.inventory.restore(input.recipe);
          this.patterns.delete(record.id);
          this.submissions.delete(input.idempotencyKey);
        },
      });
      return { record, deduplicated: false };
    } catch (error) {
      this.rollback(compensations);
      throw error;
    }
  }

  undoLast(): boolean {
    return this.history.undoLast() !== null;
  }

  addOrder(order: Order): void {
    this.validateRecipe(order.materials);
    if (this.orders.has(order.id)) {
      throw new WorkshopError(`duplicate order id: ${order.id}`);
    }
    this.orders.set(order.id, { ...order, materials: order.materials.map((c) => ({ ...c })) });
  }

  transitionOrder(orderId: string, options: StepOptions = {}): Order {
    const order = this.requireOrder(orderId);
    if (order.status !== 'pending') {
      throw new WorkshopError(`order ${orderId} cannot move from ${order.status} to in_progress`);
    }
    if (!this.inventory.canAfford(order.materials)) {
      throw new WorkshopError(`insufficient stock for order ${orderId}`);
    }

    const compensations: Array<() => void> = [];
    try {
      this.inventory.deduct(order.materials);
      compensations.push(() => this.inventory.restore(order.materials));

      this.injectFault(options.failAt, 'order.afterInventoryDeducted');

      order.status = 'in_progress' satisfies OrderStatus;
      return { ...order };
    } catch (error) {
      this.rollback(compensations);
      throw error;
    }
  }

  getPattern(id: string): PatternRecord | undefined {
    const found = this.patterns.get(id);
    return found ? { ...found, recipe: found.recipe.map((c) => ({ ...c })) } : undefined;
  }

  listPatterns(): PatternRecord[] {
    return [...this.patterns.values()].map((p) => ({
      ...p,
      recipe: p.recipe.map((c) => ({ ...c })),
    }));
  }

  getOrder(orderId: string): Order | undefined {
    const order = this.orders.get(orderId);
    return order ? { ...order, materials: order.materials.map((c) => ({ ...c })) } : undefined;
  }

  protected rollback(compensations: Array<() => void>): void {
    for (const undo of [...compensations].reverse()) {
      undo();
    }
  }

  protected injectFault(failAt: FailurePoint | undefined, point: FailurePoint): void {
    if (failAt === point) {
      throw new InjectedFault(point);
    }
  }

  private requirePattern(id: string): PatternRecord {
    const record = this.patterns.get(id);
    if (!record) throw new WorkshopError(`pattern not found: ${id}`);
    return record;
  }

  private requireOrder(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new WorkshopError(`order not found: ${orderId}`);
    return order;
  }

  private validateRecipe(recipe: MaterialCost[]): void {
    for (const cost of recipe) {
      if (!Number.isInteger(cost.amount) || cost.amount <= 0) {
        throw new WorkshopError(`invalid cost ${cost.amount} for ${cost.metal}`);
      }
    }
  }
}
