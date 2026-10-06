export const MetalType = {
  GOLD: 'gold',
  SILVER: 'silver',
  COPPER: 'copper',
} as const;
export type MetalType = (typeof MetalType)[keyof typeof MetalType];

export interface MaterialCost {
  metal: MetalType;
  amount: number;
}

export type PatternStatus = 'submitted';

export interface Pattern {
  id: string;
  name: string;
  materials: MaterialCost[];
  contentKey: string;
  status: PatternStatus;
  createdAt: number;
}

export const OrderStatus = {
  PENDING: 'pending',
  CRAFTING: 'crafting',
  DONE: 'done',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export interface Order {
  id: string;
  title: string;
  status: OrderStatus;
  materials: MaterialCost[];
}

export type InventoryMap = Record<MetalType, number>;

export interface WorkshopState {
  patterns: Pattern[];
  patternsByKey: Record<string, string>;
  inventory: InventoryMap;
  orders: Order[];
}
