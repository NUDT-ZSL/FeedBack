import { describe, test, assert, assertEqual } from './framework.js';
import { appReducer, completeOrder, isCountdownExpired } from '../src/orderLogic.js';
import { calculateIngredients, calculateDuration } from '../src/data.js';
import { makeOrder, makeInProgressOrder, makeState, consumedOf } from './fixtures.js';

const T0 = new Date('2026-01-01T08:00:00Z').getTime();

describe('倒计时自动完成与手动完成的竞态', () => {
  test('倒计时判定：到期边界恰好归零时触发，提前 1 毫秒不触发', () => {
    const order = makeInProgressOrder({
      layers: 1, // 120 分钟
      startedAt: new Date(T0),
    });
    const durationMs = 120 * 60 * 1000;
    assert(!isCountdownExpired(order, T0 + durationMs - 1), '差 1ms 到时不应判定为归零');
    assert(isCountdownExpired(order, T0 + durationMs), '恰好到时应判定为归零');
    assert(isCountdownExpired(order, T0 + durationMs + 60_000), '超时后应判定为归零');
  });

  test('倒计时判定：非制作中或缺少计时信息时不触发', () => {
    assert(!isCountdownExpired(makeOrder({ status: 'pending' }), T0 + 10 ** 13), '待处理不触发');
    assert(!isCountdownExpired(makeOrder({ status: 'completed' }), T0 + 10 ** 13), '已完成不触发');
    const noTimer = makeOrder({ status: 'in-progress' });
    assert(!isCountdownExpired(noTimer, T0 + 10 ** 13), '缺少计时信息不触发');
  });

  test('先自动完成再手动点击：状态和消耗与单次完成一致', () => {
    const order = makeInProgressOrder({ size: 8, flavor: '红丝绒', startedAt: new Date(T0) });
    const now = T0 + calculateDuration(1) * 60 * 1000 + 5000; // 已超时 5 秒
    assert(isCountdownExpired(order, now), '前置条件：倒计时已归零');

    // 模拟 OrderCard 定时器回调：判定归零后触发自动完成
    let state = makeState([order]);
    if (isCountdownExpired(state.orders[0], now)) {
      state = appReducer(state, { type: 'complete-order', orderId: order.id });
    }
    // 用户几乎同时点击了“标记为已完成”
    state = appReducer(state, { type: 'complete-order', orderId: order.id });

    assertEqual(state.orders[0].status, 'completed', '订单状态');
    const expected = calculateIngredients(8, '红丝绒');
    assertEqual(consumedOf(state.ingredients, '面粉'), expected['面粉'], '面粉只扣一次');
    assertEqual(consumedOf(state.ingredients, '可可粉'), expected['可可粉'], '可可粉只扣一次');
  });

  test('先手动点击再自动完成（定时器持有过期快照）：不重复扣减', () => {
    const order = makeInProgressOrder({ size: 12, flavor: '抹茶', startedAt: new Date(T0) });
    const now = T0 + calculateDuration(1) * 60 * 1000;

    // 用户先点击完成
    let state = makeState([order]);
    state = appReducer(state, { type: 'complete-order', orderId: order.id });

    // 定时器回调仍持有旧的订单快照，判定“已过期”并再次触发完成
    const staleSnapshot = order;
    if (isCountdownExpired(staleSnapshot, now)) {
      state = appReducer(state, { type: 'complete-order', orderId: staleSnapshot.id });
    }

    const expected = calculateIngredients(12, '抹茶');
    assertEqual(consumedOf(state.ingredients, '抹茶粉'), expected['抹茶粉'], '抹茶粉只扣一次');
    assertEqual(consumedOf(state.ingredients, '鸡蛋'), expected['鸡蛋'], '鸡蛋只扣一次');
  });

  test('同一批次内自动与手动完成动作连续入队：reducer 串行应用只扣一次', () => {
    const order = makeInProgressOrder({ size: 6, flavor: '原味', startedAt: new Date(T0) });
    let state = makeState([order]);
    // React 会将同一批次的两个动作依次应用到最新状态上
    const actions = [
      { type: 'complete-order', orderId: order.id },
      { type: 'complete-order', orderId: order.id },
    ] as const;
    for (const action of actions) {
      state = appReducer(state, action);
    }
    const expected = calculateIngredients(6, '原味');
    assertEqual(consumedOf(state.ingredients, '面粉'), expected['面粉'], '面粉只扣一次');
    assertEqual(state.orders[0].status, 'completed', '最终状态为已完成');
  });

  test('完整生命周期：提交→开始制作→倒计时归零自动完成', () => {
    const order = makeOrder({ size: 10, flavor: '巧克力', layers: 3 });
    let state = makeState([order]);
    state = appReducer(state, { type: 'start-making', orderId: order.id, now: new Date(T0) });

    const started = state.orders[0];
    assertEqual(started.status, 'in-progress', '开始制作后状态');
    assertEqual(started.estimatedDuration, calculateDuration(3), '预计时长按层数计算');

    const endTime = T0 + calculateDuration(3) * 60 * 1000;
    assert(!isCountdownExpired(started, endTime - 1000), '未到期不自动完成');
    assert(isCountdownExpired(started, endTime), '到期自动完成');

    state = completeOrder(state, order.id);
    const expected = calculateIngredients(10, '巧克力');
    assertEqual(consumedOf(state.ingredients, '黄油'), expected['黄油'], '黄油按配方扣减');
  });
});
