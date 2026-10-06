import { METALS, WorkshopError } from './types.ts';
import type { MaterialCost, MetalType, Stock } from './types.ts';

export class InventoryStore {
  private stock: Stock;

  constructor(initial: Partial<Stock> = {}) {
    this.stock = { gold: 0, silver: 0, copper: 0 };
    for (const metal of METALS) {
      const value = initial[metal];
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 0) {
          throw new WorkshopError(`invalid initial stock for ${metal}: ${value}`);
        }
        this.stock[metal] = value;
      }
    }
  }

  snapshot(): Stock {
    return { ...this.stock };
  }

  available(metal: MetalType): number {
    return this.stock[metal];
  }

  canAfford(costs: MaterialCost[]): boolean {
    return costs.every((c) => this.stock[c.metal] >= c.amount);
  }

  deduct(costs: MaterialCost[]): void {
    for (const cost of costs) {
      if (this.stock[cost.metal] < cost.amount) {
        throw new WorkshopError(
          `insufficient stock for ${cost.metal}: need ${cost.amount}, have ${this.stock[cost.metal]}`,
        );
      }
    }
    for (const cost of costs) {
      this.stock[cost.metal] -= cost.amount;
    }
  }

  restore(costs: MaterialCost[]): void {
    for (const cost of costs) {
      this.stock[cost.metal] += cost.amount;
    }
  }
}

export function stockEquals(a: Stock, b: Stock): boolean {
  return METALS.every((metal) => a[metal] === b[metal]);
}
