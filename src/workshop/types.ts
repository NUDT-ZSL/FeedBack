export const METALS = ['gold', 'silver', 'copper'] as const;
export type MetalType = (typeof METALS)[number];

export type Stock = Record<MetalType, number>;

export interface MaterialCost {
  metal: MetalType;
  amount: number;
}

export type PatternStatus = 'submitted' | 'revoked';

export interface PatternRecord {
  id: string;
  name: string;
  recipe: MaterialCost[];
  status: PatternStatus;
  seq: number;
}

export const ORDER_STATUSES = ['pending', 'in_progress', 'done'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: string;
  title: string;
  status: OrderStatus;
  materials: MaterialCost[];
}

export type FailurePoint =
  | 'pattern.afterInventoryDeducted'
  | 'order.afterInventoryDeducted';

export class WorkshopError extends Error {}

export class InjectedFault extends Error {
  readonly point: FailurePoint;

  constructor(point: FailurePoint) {
    super(`injected fault at ${point}`);
    this.name = 'InjectedFault';
    this.point = point;
  }
}
