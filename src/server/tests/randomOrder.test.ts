import { ExchangeStatus } from '../types';
import { VALID_TRANSITIONS } from '../services/exchangeDomain';
import { test, assert, assertEqual, makeStore, assertConsistent, assertUnreadMatches } from './helpers';

const SUITE = '任意处理顺序下的不变量';

const USERS = ['u1', 'u2', 'u3'];
const ALL_STATUSES: ExchangeStatus[] = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];

/** 确定性伪随机数生成器（mulberry32），保证用例可重复 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

for (const seed of [20260928, 7, 1337, 424242, 98765]) {
  test(SUITE, `随机乱序操作序列（种子 ${seed}）下所有不变量始终成立`, () => {
    const rand = mulberry32(seed);
    const store = makeStore();

    // 预置若干交换申请（部分故意重复，验证去重）
    for (let i = 0; i < 8; i++) {
      const requester = pick(rand, USERS);
      let owner = pick(rand, USERS);
      if (owner === requester) owner = USERS[(USERS.indexOf(requester) + 1) % USERS.length];
      store.createExchange({
        bookId: `b${Math.floor(rand() * 4)}`,
        requesterId: requester,
        ownerId: owner,
      });
    }

    // 记录每个交换的上一状态，用于验证不存在非法跃迁/回退
    const lastStatus = new Map(store.exchanges.map((e) => [e.id, e.status as ExchangeStatus]));
    let lastMessageCount = store.messages.length;

    for (let step = 0; step < 300; step++) {
      const op = Math.floor(rand() * 4);

      if (op === 0 && store.exchanges.length > 0) {
        // 随机处理某个交换（含重复处理、回退、越权等非法情形）
        const exchange = pick(rand, store.exchanges);
        const target = pick(rand, ALL_STATUSES);
        const actor = pick(rand, [...USERS, 'stranger']);
        const before = exchange.status;
        const msgBefore = store.messages.length;
        const result = store.processExchange(exchange.id, target, actor, '随机操作');
        if (result.ok && result.changed) {
          assert(
            VALID_TRANSITIONS[before].includes(target),
            `第 ${step} 步：发生了非法跃迁 ${before} -> ${target}`
          );
          assertEqual(store.messages.length, msgBefore + 1, '有效流转应恰好追加一条通知');
        } else {
          assertEqual(exchange.status, before, `第 ${step} 步：被拒绝的操作不应改变状态`);
          assertEqual(store.messages.length, msgBefore, '被拒绝/幂等的操作不应追加通知');
        }
      } else if (op === 1) {
        // 随机标记某用户的一条通知为已读
        const uid = pick(rand, USERS);
        const mine = store.messages.filter((m) => m.receiverId === uid);
        if (mine.length > 0) {
          const target = pick(rand, mine);
          const othersUnreadBefore = store.messages.filter(
            (m) => m.id !== target.id && !m.isRead
          ).length;
          store.markMessageRead(target.id, uid);
          assert(target.isRead, '目标通知应被标记为已读');
          const othersUnreadAfter = store.messages.filter(
            (m) => m.id !== target.id && !m.isRead
          ).length;
          assertEqual(othersUnreadAfter, othersUnreadBefore, '其它通知的已读状态不应被波及');
        }
      } else if (op === 2) {
        // 随机标记某用户全部已读
        const uid = pick(rand, USERS);
        store.markAllRead(uid);
        assertEqual(store.getUnreadCount(uid), 0, '标记全部已读后未读数必须为 0');
      } else {
        // 随机重新拉取通知（并篡改副本，验证不影响内部状态）
        const uid = pick(rand, USERS);
        const pulled = store.getMessagesForUser(uid);
        pulled.forEach((m) => { m.isRead = true; });
      }

      // 每一步之后：核心不变量都必须成立
      assertConsistent(store);
      assertUnreadMatches(store, USERS);
      assert(
        store.messages.length >= lastMessageCount,
        `第 ${step} 步：通知数量不应减少（发现静默丢失）`
      );
      lastMessageCount = store.messages.length;
      for (const e of store.exchanges) {
        const prev = lastStatus.get(e.id)!;
        assert(
          prev === e.status || VALID_TRANSITIONS[prev].includes(e.status),
          `第 ${step} 步：交换 ${e.id} 出现非法状态变化 ${prev} -> ${e.status}`
        );
        lastStatus.set(e.id, e.status);
      }
    }
  });
}
