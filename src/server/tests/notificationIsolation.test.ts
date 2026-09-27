import { test, assert, assertEqual, makeStore, assertConsistent, assertUnreadMatches } from './helpers';

const SUITE = '同一申请多条通知的隔离性';

/** 构造同一申请下同一用户持有多条通知的场景：u2 收到申请通知 + 取消通知 */
function buildMultiNoticeStore() {
  const store = makeStore();
  const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  const exchange = created.exchange!;
  store.processExchange(exchange.id, 'cancelled', 'u1');
  const linked = store.messages.filter((m) => m.relatedExchangeId === exchange.id);
  return { store, exchange, linked };
}

test(SUITE, '同一申请的多条通知：标记其中一条已读不影响其它通知的已读状态', () => {
  const { store, exchange, linked } = buildMultiNoticeStore();
  assert(linked.length >= 2, '同一申请应存在多条通知');
  const ownerNotices = linked.filter((m) => m.receiverId === 'u2');
  assert(ownerNotices.length >= 2, 'u2 应持有多条该申请的通知');

  const before = store.getUnreadCount('u2');
  store.markMessageRead(ownerNotices[0].id, 'u2');

  for (const m of ownerNotices.slice(1)) {
    const current = store.messages.find((x) => x.id === m.id)!;
    assertEqual(current.isRead, false, `通知 ${m.id} 不应被连带标记为已读`);
  }
  assertEqual(store.getUnreadCount('u2'), before - 1, '未读数应只减少 1');
  assertConsistent(store);
  assertUnreadMatches(store, ['u1', 'u2']);
});

test(SUITE, '标记一条已读不改变其它通知的状态标记', () => {
  const { store, exchange, linked } = buildMultiNoticeStore();
  const markersBefore = new Map(linked.map((m) => [m.id, m.exchangeStatus]));
  store.markMessageRead(linked[0].id, linked[0].receiverId);
  for (const m of store.messages) {
    if (markersBefore.has(m.id)) {
      assertEqual(m.exchangeStatus, markersBefore.get(m.id), `通知 ${m.id} 的状态标记不应被已读操作改动`);
    }
  }
  assertConsistent(store);
});

test(SUITE, '处理其中一条通知不会删除或覆盖同一申请的其它通知', () => {
  const { store, linked } = buildMultiNoticeStore();
  const idsBefore = store.messages.map((m) => m.id);
  store.markMessageRead(linked[0].id, linked[0].receiverId);
  store.markAllRead(linked[0].receiverId);
  const idsAfter = store.messages.map((m) => m.id);
  assertEqual(idsAfter.length, idsBefore.length, '已读操作不应增减通知数量');
  for (const id of idsBefore) {
    assert(idsAfter.includes(id), `通知 ${id} 不应在已读操作中丢失`);
  }
  assertConsistent(store);
});

test(SUITE, '状态同步只更新本申请的通知标记，不波及其它申请的通知', () => {
  const store = makeStore();
  const e1 = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' }).exchange!;
  const e2 = store.createExchange({ bookId: 'b2', requesterId: 'u1', ownerId: 'u2' }).exchange!;

  store.processExchange(e1.id, 'approved', 'u2');

  for (const m of store.messages) {
    if (m.relatedExchangeId === e1.id) {
      assertEqual(m.exchangeStatus, 'approved', '本申请通知标记应同步为 approved');
    } else if (m.relatedExchangeId === e2.id) {
      assertEqual(m.exchangeStatus, 'pending', '其它申请的通知标记不应被波及');
    }
  }
  assertEqual(store.findExchange(e2.id)!.status, 'pending', '其它申请的状态不应被波及');
  assertConsistent(store);
});

test(SUITE, '同一申请的双方各自收到通知，已读操作互不影响', () => {
  const store = makeStore();
  const e = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' }).exchange!;
  store.processExchange(e.id, 'approved', 'u2'); // u1 收到更新通知
  store.processExchange(e.id, 'completed', 'u1'); // u2 收到更新通知

  const u1Before = store.getUnreadCount('u1');
  const u2Before = store.getUnreadCount('u2');
  assert(u1Before > 0 && u2Before > 0, '双方都应持有未读通知');

  store.markAllRead('u1');
  assertEqual(store.getUnreadCount('u1'), 0, 'u1 应全部已读');
  assertEqual(store.getUnreadCount('u2'), u2Before, 'u2 的未读数不应受 u1 影响');
  assertConsistent(store);
  assertUnreadMatches(store, ['u1', 'u2']);
});
