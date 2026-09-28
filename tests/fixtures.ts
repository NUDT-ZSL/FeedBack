import type { Order, Ingredient, CakeSize, CakeFlavor, OrderStatus } from '../src/types.js';
import { initialIngredients, calculateDuration } from '../src/data.js';
import type { AppState } from '../src/orderLogic.js';

let idCounter = 0;

/** 构造一个订单，默认待处理；可指定任意字段覆盖。 */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  idCounter += 1;
  return {
    id: `test-${idCounter}`,
    size: 8 as CakeSize,
    layers: 1,
    flavor: '原味' as CakeFlavor,
    decorationNote: '',
    status: 'pending' as OrderStatus,
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** 构造一个“制作中”订单，计时信息完整。 */
export function makeInProgressOrder(overrides: Partial<Order> = {}): Order {
  const layers = overrides.layers ?? 1;
  return makeOrder({
    status: 'in-progress',
    startedAt: new Date('2026-01-01T08:00:00Z'),
    estimatedDuration: calculateDuration(layers),
    ...overrides,
  });
}

/** 深拷贝初始原料表，避免用例间互相污染。 */
export function freshIngredients(): Ingredient[] {
  return initialIngredients.map(ing => ({ ...ing }));
}

export function makeState(orders: Order[], ingredients: Ingredient[] = freshIngredients()): AppState {
  return { orders, ingredients };
}

/** 从原料表中取某种原料的已消耗量。 */
export function consumedOf(ingredients: Ingredient[], name: Ingredient['name']): number {
  const ing = ingredients.find(i => i.name === name);
  if (!ing) throw new Error(`原料不存在：${name}`);
  return ing.consumed;
}
