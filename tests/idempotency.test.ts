import { describe, test, assert, assertEqual, assertDeepEqual } from './framework.js';
import { appReducer, completeOrder } from '../src/orderLogic.js';
import { calculateIngredients } from '../src/data.js';
import { makeOrder, makeInProgressOrder, makeState, consumedOf } from './fixtures.js';

describe('重复完成幂等性', () => {
  test('制作中订单被重复触发完成，原料只扣减一次', () => {
    const order = makeInProgressOrder({ size: 8, flavor: '巧克力' });
    const once = completeOrder(makeState([order]), order.id);
    const twice = completeOrder(once, order.id);

    assertEqual(twice.orders.find(o => o.id === order.id)?.status, 'completed', '订单状态');
    assertDeepEqual(
      twice.ingredients,
      once.ingredients,
      '第二次完成不应再改变原料消耗',
    );

    const expected = calculateIngredients(8, '巧克力');
    assertEqual(consumedOf(twice.ingredients, '面粉'), expected['面粉'], '面粉消耗应等于单次配方量');
    assertEqual(consumedOf(twice.ingredients, '可可粉'), expected['可可粉'], '可可粉消耗应等于单次配方量');
  });

  test('通过 reducer 连续派发三次完成动作，消耗仍等于单次', () => {
    const order = makeInProgressOrder({ size: 10, flavor: '芒果' });
    let state = makeState([order]);
    state = appReducer(state, { type: 'complete-order', orderId: order.id });
    state = appReducer(state, { type: 'complete-order', orderId: order.id });
    state = appReducer(state, { type: 'complete-order', orderId: order.id });

    const expected = calculateIngredients(10, '芒果');
    assertEqual(consumedOf(state.ingredients, '芒果果泥'), expected['芒果果泥'], '芒果果泥只扣一次');
    assertEqual(consumedOf(state.ingredients, '奶油'), expected['奶油'], '奶油只扣一次');
  });

  test('对已完成的初始订单再触发完成，状态原样返回', () => {
    const order = makeOrder({ status: 'completed' });
    const state = makeState([order]);
    const next = completeOrder(state, order.id);
    assert(next === state, '已完成订单触发完成应原样返回（引用不变）');
  });

  test('对不存在的订单号触发完成，状态原样返回', () => {
    const order = makeInProgressOrder();
    const state = makeState([order]);
    const next = completeOrder(state, 'no-such-order');
    assert(next === state, '未知订单号不应改变状态');
  });

  test('待处理订单直接完成不扣减原料（当前业务约定）', () => {
    const order = makeOrder({ status: 'pending' });
    const next = completeOrder(makeState([order]), order.id);
    assertEqual(next.orders[0].status, 'completed', '状态应流转为已完成');
    assert(
      next.ingredients.every(ing => ing.consumed === 0),
      '待处理订单完成不应产生原料消耗',
    );
  });

  test('多个订单各自完成，消耗按订单逐一累加且互不重复', () => {
    const a = makeInProgressOrder({ size: 6, flavor: '原味' });
    const b = makeInProgressOrder({ size: 12, flavor: '抹茶' });
    let state = makeState([a, b]);
    state = completeOrder(state, a.id);
    state = completeOrder(state, b.id);
    state = completeOrder(state, a.id); // 重复触发 a

    const ea = calculateIngredients(6, '原味');
    const eb = calculateIngredients(12, '抹茶');
    assertEqual(consumedOf(state.ingredients, '面粉'), ea['面粉'] + eb['面粉'], '面粉应为两单之和');
    assertEqual(consumedOf(state.ingredients, '抹茶粉'), eb['抹茶粉'], '抹茶粉只来自抹茶订单');
  });
});
