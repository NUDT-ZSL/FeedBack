import { test, assert, assertEqual, makeStore, assertConsistent, assertUnreadMatches, manualUnread } from './helpers';

const SUITE = '未读计数与通知集合吻合';

/** 构造：u1 向 u2 的两本书各发起一次交换，并推进状态，使 u1/u2 都有多条通知 */
function buildStore() {
  const store = makeStore();
  const e1 = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' }).exchange!;
  const e2 = store.createExchange({ bookId: 'b2', requesterId: 'u1', ownerId: 'u2' }).exchange!;
  const e3 = store.createExchange({ bookId: 'b3', requesterId: 'u3', ownerId: 'u1' }).exchange!;
  store.processExchange(e1.id, 'approved', 'u2');
  store.processExchange(e2.id, 'rejected', 'u2');
  store.processExchange(e1.id, 'completed', 'u1');
  return { store, e1, e2, e3 };
}

test(SUITE, '初始未读数等于集合中实际未读条目数', () => {
  const { store } = buildStore();
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
  assert(store.getUnreadCount('u1') > 0, 'u1 应有未读通知');
  assert(store.getUnreadCount('u2') > 0, 'u2 应有未读通知');
});

test(SUITE, '重新拉取通知后未读数不变，且与拉取结果中的未读条目一致', () => {
  const { store } = buildStore();
  for (const uid of ['u1', 'u2', 'u3']) {
    const before = store.getUnreadCount(uid);
    const pulled = store.getMessagesForUser(uid);
    assertEqual(store.getUnreadCount(uid), before, `重新拉取不应改变 ${uid} 的未读数`);
    assertEqual(
      pulled.filter((m) => !m.isRead).length,
      before,
      `拉取结果中的未读条目数应与未读计数一致`
    );
  }
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '对拉取到的副本修改不影响存储内部状态', () => {
  const { store } = buildStore();
  const pulled = store.getMessagesForUser('u2');
  assert(pulled.length > 0, 'u2 应有通知');
  pulled.forEach((m) => { m.isRead = true; });
  assert(store.getUnreadCount('u2') > 0, '修改拉取副本不应影响真实未读数');
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '逐条标记已读：未读数每次恰好减一，重复标记幂等', () => {
  const { store } = buildStore();
  const uid = 'u2';
  let expected = store.getUnreadCount(uid);
  const unread = store.getMessagesForUser(uid).filter((m) => !m.isRead);
  for (const m of unread) {
    const marked = store.markMessageRead(m.id, uid);
    assert(marked && marked.isRead, `通知 ${m.id} 应被标记为已读`);
    expected -= 1;
    assertEqual(store.getUnreadCount(uid), expected, '标记一条后未读数应减一');
    const again = store.markMessageRead(m.id, uid);
    assert(again && again.isRead, '重复标记同一条应幂等');
    assertEqual(store.getUnreadCount(uid), expected, '重复标记不应再改变未读数');
  }
  assertEqual(store.getUnreadCount(uid), 0, '全部标记后未读数应为 0');
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '标记全部已读后未读数为零，再次执行幂等', () => {
  const { store } = buildStore();
  const marked = store.markAllRead('u1');
  assert(marked > 0, '首次标记全部已读应有实际标记数量');
  assertEqual(store.getUnreadCount('u1'), 0, '标记全部已读后未读数应为 0');
  assertEqual(store.markAllRead('u1'), 0, '再次标记全部已读应无新增标记');
  assertEqual(store.getUnreadCount('u1'), 0, '重复执行后未读数仍为 0');
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '标记全部已读只影响本人，不影响其他用户未读数', () => {
  const { store } = buildStore();
  const u2Before = store.getUnreadCount('u2');
  const u3Before = store.getUnreadCount('u3');
  store.markAllRead('u1');
  assertEqual(store.getUnreadCount('u2'), u2Before, 'u1 的标记全部已读不应影响 u2');
  assertEqual(store.getUnreadCount('u3'), u3Before, 'u1 的标记全部已读不应影响 u3');
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '全部已读之后新通知到达，未读数重新与集合吻合', () => {
  const { store, e3 } = buildStore();
  store.markAllRead('u1');
  assertEqual(store.getUnreadCount('u1'), 0, '标记后未读数应为 0');
  store.processExchange(e3.id, 'cancelled', 'u3');
  assertEqual(store.getUnreadCount('u1'), 1, '新通知到达后未读数应为 1');
  assertEqual(manualUnread(store, 'u1'), 1, '集合实际未读条目应为 1');
  assertConsistent(store);
  assertUnreadMatches(store, ['u1', 'u2', 'u3']);
});

test(SUITE, '用他人身份标记不存在的通知返回空且不改变任何计数', () => {
  const { store } = buildStore();
  const u2Msg = store.getMessagesForUser('u2')[0];
  const before1 = store.getUnreadCount('u1');
  const before2 = store.getUnreadCount('u2');
  assertEqual(store.markMessageRead(u2Msg.id, 'u1'), null, 'u1 不应能标记 u2 的通知');
  assertEqual(store.markMessageRead('msg-not-exist', 'u1'), null, '不存在的通知应返回空');
  assertEqual(store.getUnreadCount('u1'), before1, 'u1 未读数不应变化');
  assertEqual(store.getUnreadCount('u2'), before2, 'u2 未读数不应变化');
});
