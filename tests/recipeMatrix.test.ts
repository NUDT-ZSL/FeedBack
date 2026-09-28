import { describe, test, assert, assertEqual, assertClose } from './framework.js';
import { calculateIngredients, calculateDuration } from '../src/data.js';
import { completeOrder, isLowStock, LOW_STOCK_RATIO } from '../src/orderLogic.js';
import type { CakeSize, CakeFlavor, IngredientName, Ingredient } from '../src/types.js';
import { makeInProgressOrder, makeState, consumedOf } from './fixtures.js';

/** 测试侧独立维护的配方规格表（与被测实现分开书写，互为校验）。 */
const SPEC_BASE: Record<IngredientName, number> = {
  '面粉': 150, '糖': 100, '黄油': 80, '鸡蛋': 4,
  '奶油': 200, '可可粉': 0, '抹茶粉': 0, '芒果果泥': 0,
};
const SPEC_MULTIPLIER: Record<CakeSize, number> = { 6: 1, 8: 1.5, 10: 2.25, 12: 3.375 };
const SPEC_ADJUST: Record<CakeFlavor, Partial<Record<IngredientName, number>>> = {
  '原味': {},
  '巧克力': { '可可粉': 30, '面粉': -20 },
  '抹茶': { '抹茶粉': 15, '面粉': -10 },
  '芒果': { '芒果果泥': 100, '奶油': -50 },
  '红丝绒': { '可可粉': 10, '面粉': -10 },
};
const ALL_NAMES = Object.keys(SPEC_BASE) as IngredientName[];
const SIZES: CakeSize[] = [6, 8, 10, 12];
const FLAVORS: CakeFlavor[] = ['原味', '巧克力', '抹茶', '红丝绒', '芒果'];

function expectedAmount(size: CakeSize, flavor: CakeFlavor, name: IngredientName): number {
  let amount = SPEC_BASE[name] * SPEC_MULTIPLIER[size];
  const adj = SPEC_ADJUST[flavor][name];
  if (adj !== undefined) amount += adj;
  return Math.round(amount * 10) / 10;
}

describe('配方消耗计算矩阵（尺寸×口味）', () => {
  test('全部 20 种尺寸×口味组合均符合配方规格', () => {
    for (const size of SIZES) {
      for (const flavor of FLAVORS) {
        const result = calculateIngredients(size, flavor);
        for (const name of ALL_NAMES) {
          assertClose(
            result[name],
            expectedAmount(size, flavor, name),
            `${size}寸${flavor}的${name}`,
          );
        }
      }
    }
  });

  test('关键组合的具体数值抽样', () => {
    assertEqual(calculateIngredients(8, '巧克力')['面粉'], 205, '8寸巧克力面粉=150*1.5-20');
    assertEqual(calculateIngredients(8, '巧克力')['可可粉'], 30, '8寸巧克力可可粉');
    assertEqual(calculateIngredients(10, '芒果')['奶油'], 400, '10寸芒果奶油=200*2.25-50');
    assertEqual(calculateIngredients(12, '原味')['鸡蛋'], 13.5, '12寸原味鸡蛋=4*3.375');
    assertEqual(calculateIngredients(6, '抹茶')['抹茶粉'], 15, '6寸抹茶抹茶粉');
  });

  test('所有组合的计算结果都按 0.1 精度取整', () => {
    for (const size of SIZES) {
      for (const flavor of FLAVORS) {
        const result = calculateIngredients(size, flavor);
        for (const name of ALL_NAMES) {
          const scaled = result[name] * 10;
          assertClose(scaled, Math.round(scaled), `${size}寸${flavor}的${name}应精确到0.1`);
        }
      }
    }
  });

  test('层数不影响原料消耗，只影响预计制作时长', () => {
    for (const layers of [1, 2, 3]) {
      const order = makeInProgressOrder({ size: 8, flavor: '原味', layers });
      const state = completeOrder(makeState([order]), order.id);
      assertEqual(consumedOf(state.ingredients, '面粉'), 225, `8寸原味${layers}层面粉消耗`);
    }
    assertEqual(calculateDuration(1), 120, '1层时长');
    assertEqual(calculateDuration(2), 150, '2层时长');
    assertEqual(calculateDuration(3), 180, '3层时长');
  });
});

describe('低库存阈值边界（剩余量 < 初始库存 20%）', () => {
  const flour = (consumed: number): Ingredient => ({
    id: 'x', name: '面粉', initialStock: 5000, consumed, unit: 'g',
  });

  test('阈值常量与边界行为：恰好 20% 不算低库存，严格小于才算', () => {
    assertEqual(LOW_STOCK_RATIO, 0.2, '低库存阈值比例');
    assert(!isLowStock(flour(0)), '未消耗：充足');
    assert(!isLowStock(flour(3999.9)), '剩余 1000.1（略高于20%）：充足');
    assert(!isLowStock(flour(4000)), '剩余恰好 1000（恰好20%）：不算低库存');
    assert(isLowStock(flour(4000.1)), '剩余 999.9（略低于20%）：低库存');
    assert(isLowStock(flour(5000)), '剩余 0：低库存');
  });

  test('不同初始库存下阈值按比例缩放（鸡蛋，阈值 20 个）', () => {
    const eggs = (consumed: number): Ingredient => ({
      id: 'y', name: '鸡蛋', initialStock: 100, consumed, unit: '个',
    });
    assert(!isLowStock(eggs(80)), '剩余恰好 20：充足');
    assert(isLowStock(eggs(80.5)), '剩余 19.5：低库存');
    assert(!isLowStock(eggs(79.5)), '剩余 20.5：充足');
  });

  test('完成订单后的库存判定与手工计算一致', () => {
    // 抹茶粉初始 300，阈值 60。6寸抹茶每单消耗 15，16 单后剩余恰好 60（20%）。
    let state = makeState([]);
    for (let i = 0; i < 16; i++) {
      const order = makeInProgressOrder({ size: 6, flavor: '抹茶' });
      state = completeOrder({ ...state, orders: [...state.orders, order] }, order.id);
    }
    const matcha = state.ingredients.find(i => i.name === '抹茶粉')!;
    assertEqual(matcha.consumed, 240, '16 单累计消耗');
    assert(!isLowStock(matcha), '剩余恰好 20% 时不应报低库存');

    // 再完成 1 单：剩余 45 < 60，应报低库存
    const oneMore = makeInProgressOrder({ size: 6, flavor: '抹茶' });
    state = completeOrder({ ...state, orders: [...state.orders, oneMore] }, oneMore.id);
    const matchaAfter = state.ingredients.find(i => i.name === '抹茶粉')!;
    assert(isLowStock(matchaAfter), '剩余低于 20% 时应报低库存');
  });
});
