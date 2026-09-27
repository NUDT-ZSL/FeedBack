import { ExchangeStatus } from '../types';
import { test, assert, assertEqual, makeStore, assertConsistent } from './helpers';

const SUITE = '状态流转与通知标记一致性';

const ALL_STATUSES: ExchangeStatus[] = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];

function markersOf(store: ReturnType<typeof makeStore>, exchangeId: string) {
  return store.messages.filter((m) => m.relatedExchangeId === exchangeId);
}

test(SUITE, '同一申请被重复处理为同一状态时幂等：不产生重复通知，标记保持一致', () => {
  const store = makeStore();
  const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  assert(created.ok && created.exchange, '创建交换失败');
  const id = created.exchange!.id;

  const first = store.processExchange(id, 'approved', 'u2');
  assert(first.ok && first.changed, '首次批准应生效');
  const msgCountAfterFirst = store.messages.length;

  for (let i = 0; i < 3; i++) {
    const dup = store.processExchange(id, 'approved', 'u2');
    assert(dup.ok && !dup.changed, `第 ${i + 1} 次重复批准应幂等`);
    assert(!dup.notification, '重复处理不应产生新通知');
  }
  assertEqual(store.messages.length, msgCountAfterFirst, '重复处理后通知数量不应增加');
  assertEqual(store.findExchange(id)!.status, 'approved', '交换状态应保持 approved');
  for (const m of markersOf(store, id)) {
    assertEqual(m.exchangeStatus, 'approved', `通知 ${m.id} 的状态标记应与交换记录一致`);
  }
  assertConsistent(store);
});

test(SUITE, '状态回退与非法流转被拒绝：交换记录与通知标记保持原状', () => {
  const store = makeStore();
  const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  const id = created.exchange!.id;

  store.processExchange(id, 'approved', 'u2');
  const snapshot = store.messages.map((m) => ({ ...m }));

  const regress = store.processExchange(id, 'pending', 'u2');
  assert(!regress.ok && regress.error === 'INVALID_TRANSITION', 'approved 回退 pending 应被拒绝');
  assertEqual(store.findExchange(id)!.status, 'approved', '回退被拒绝后状态应保持 approved');
  assertEqual(store.messages.length, snapshot.length, '非法流转不应产生新通知');
  for (const m of store.messages) {
    const before = snapshot.find((s) => s.id === m.id)!;
    assertEqual(m.exchangeStatus, before.exchangeStatus, `通知 ${m.id} 标记不应被非法流转改动`);
    assertEqual(m.isRead, before.isRead, `通知 ${m.id} 已读状态不应被非法流转改动`);
  }
  assertConsistent(store);
});

test(SUITE, '终态不可再变更：rejected/completed/cancelled 之后任何流转都被拒绝', () => {
  const terminals: Array<{ path: ExchangeStatus[]; terminal: ExchangeStatus }> = [
    { path: ['rejected'], terminal: 'rejected' },
    { path: ['approved', 'completed'], terminal: 'completed' },
    { path: ['cancelled'], terminal: 'cancelled' },
  ];
  for (const { path, terminal } of terminals) {
    const store = makeStore();
    const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
    const id = created.exchange!.id;
    for (const s of path) {
      const r = store.processExchange(id, s, 'u2');
      assert(r.ok && r.changed, `流转到 ${s} 应成功`);
    }
    for (const target of ALL_STATUSES) {
      const r = store.processExchange(id, target, 'u2');
      if (target === terminal) {
        assert(r.ok && !r.changed, `终态 ${terminal} 的重复处理应幂等`);
      } else {
        assert(!r.ok && r.error === 'INVALID_TRANSITION', `终态 ${terminal} 不应允许流转到 ${target}`);
      }
      assertEqual(store.findExchange(id)!.status, terminal, `终态 ${terminal} 不应被改变`);
    }
    assertConsistent(store);
  }
});

test(SUITE, '完整流转链 pending→approved→completed 每一步所有通知标记同步', () => {
  const store = makeStore();
  const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  const id = created.exchange!.id;
  for (const target of ['approved', 'completed'] as ExchangeStatus[]) {
    store.processExchange(id, target, 'u2');
    const linked = markersOf(store, id);
    assert(linked.length >= 2, '每次流转都应追加一条通知');
    for (const m of linked) {
      assertEqual(m.exchangeStatus, target, `流转到 ${target} 后通知 ${m.id} 的标记应同步`);
    }
    assertConsistent(store);
  }
});

test(SUITE, '越权处理被拒绝且不影响任何数据', () => {
  const store = makeStore();
  const created = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  const id = created.exchange!.id;
  const r = store.processExchange(id, 'approved', 'stranger');
  assert(!r.ok && r.error === 'FORBIDDEN', '无关用户处理应被拒绝');
  assertEqual(store.findExchange(id)!.status, 'pending', '越权操作不应改变状态');
  assertEqual(store.messages.length, 1, '越权操作不应产生通知');
  assertConsistent(store);
});

test(SUITE, '同一书籍同一申请人的重复 pending 申请被拒绝', () => {
  const store = makeStore();
  const first = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  const dup = store.createExchange({ bookId: 'b1', requesterId: 'u1', ownerId: 'u2' });
  assert(first.ok, '首次申请应成功');
  assert(!dup.ok && dup.error === 'DUPLICATE_PENDING', '重复 pending 申请应被拒绝');
  assertEqual(store.exchanges.length, 1, '不应产生重复交换记录');
  assertEqual(store.messages.length, 1, '不应产生重复通知');
  assertConsistent(store);
});
