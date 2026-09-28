import type { Order, Ingredient, IngredientName } from './types.js';
import { calculateIngredients, calculateDuration } from './data.js';

/**
 * 订单状态与原料消耗的纯领域逻辑。
 * 与 React 渲染解耦，可在 Node 环境下离线运行与测试。
 */

export interface AppState {
  orders: Order[];
  ingredients: Ingredient[];
}

export type AppAction =
  | { type: 'submit-order'; order: Order }
  | { type: 'start-making'; orderId: string; now?: Date }
  | { type: 'complete-order'; orderId: string };

/** 低库存阈值：剩余量低于初始库存的 20% 判定为库存不足（严格小于）。 */
export const LOW_STOCK_RATIO = 0.2;

export function isLowStock(ingredient: Ingredient): boolean {
  const remaining = ingredient.initialStock - ingredient.consumed;
  return remaining < ingredient.initialStock * LOW_STOCK_RATIO;
}

/** 将一份配方消耗量累加到原料库存上，返回新数组（不修改入参）。 */
export function applyConsumption(
  ingredients: Ingredient[],
  consumption: Record<IngredientName, number>,
): Ingredient[] {
  return ingredients.map(ing => {
    const amount = consumption[ing.name];
    if (amount === undefined) return ing;
    return { ...ing, consumed: Math.round((ing.consumed + amount) * 10) / 10 };
  });
}

/**
 * 完成订单。幂等：订单已是“已完成”时原样返回，不重复扣减原料。
 * 只有从“制作中”完成才扣减原料；“待处理”直接完成不扣减。
 */
export function completeOrder(state: AppState, orderId: string): AppState {
  const order = state.orders.find(o => o.id === orderId);
  if (!order || order.status === 'completed') return state;

  const consumption =
    order.status === 'in-progress'
      ? calculateIngredients(order.size, order.flavor)
      : null;

  return {
    orders: state.orders.map(o =>
      o.id === orderId ? { ...o, status: 'completed' as const } : o,
    ),
    ingredients: consumption
      ? applyConsumption(state.ingredients, consumption)
      : state.ingredients,
  };
}

/** 开始制作。仅“待处理”订单可流转，重复调用不产生变化。 */
export function startMaking(state: AppState, orderId: string, now: Date = new Date()): AppState {
  return {
    ...state,
    orders: state.orders.map(order => {
      if (order.id === orderId && order.status === 'pending') {
        return {
          ...order,
          status: 'in-progress' as const,
          startedAt: now,
          estimatedDuration: calculateDuration(order.layers),
        };
      }
      return order;
    }),
  };
}

/**
 * 倒计时是否已归零（应触发自动完成）。
 * 仅对“制作中”且计时信息完整的订单有意义；nowMs 可注入，测试无需真实等待。
 */
export function isCountdownExpired(order: Order, nowMs: number = Date.now()): boolean {
  if (order.status !== 'in-progress' || !order.startedAt || !order.estimatedDuration) {
    return false;
  }
  const durationMs = order.estimatedDuration * 60 * 1000;
  return nowMs - order.startedAt.getTime() >= durationMs;
}

/** 统一状态 reducer：所有状态流转的唯一入口，纯函数，可离线验证。 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'submit-order':
      return { ...state, orders: [...state.orders, action.order] };
    case 'start-making':
      return startMaking(state, action.orderId, action.now);
    case 'complete-order':
      return completeOrder(state, action.orderId);
  }
}
