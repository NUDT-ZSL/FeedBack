import { suite, test, assert, assertEqual } from './harness';
import { buildWorld, World } from './fixtures';
import { assertWorldInvariants } from './invariants';
import { DomainError, ExchangeStatus } from '../services/exchangeService';

// 确定性伪随机数（mulberry32），保证失败可复现
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const STATUSES: ExchangeStatus[] = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];

const snapshotOf = (world: World) => ({
  exchangeStatuses: world.exchanges.map((e) => `${e.id}:${e.status}`).join('|'),
  messageCount: world.messages.length,
  readFlags: world.messages.map((m) => `${m.id}:${m.isRead}`).join('|'),
});

const runRandomSequence = (seed: number, steps: number) => {
  const world = buildWorld();
  const { service, users, books } = world;
  const rand = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  for (let i = 0; i < steps; i += 1) {
    const op = Math.floor(rand() * 5);
    const before = snapshotOf(world);
    try {
      if (op === 0) {
        // 随机发起申请（可能触发重复申请/换自己的书等拒绝路径）
        const book = pick(books);
        const requester = pick(users);
        service.createExchange({ bookId: book.id, requesterId: requester.id });
      } else if (op === 1 && world.exchanges.length > 0) {
        // 随机状态变更（含重复处理与回退等非法尝试）
        const exchange = pick(world.exchanges);
        const actor = pick(users);
        service.updateExchangeStatus({
          exchangeId: exchange.id,
          status: pick(STATUSES),
          actorId: actor.id,
        });
      } else if (op === 2 && world.messages.length > 0) {
        // 随机标记单条已读（可能越权或不存在）
        const message = pick(world.messages);
        const user = pick(users);
        service.markMessageRead(user.id, message.id);
      } else if (op === 3) {
        service.markAllMessagesRead(pick(users).id);
      } else {
        // 重新拉取并核对计数
        const user = pick(users);
        const fetched = service.getMessagesForUser(user.id);
        assertEqual(
          service.getUnreadCount(user.id),
          fetched.filter((m) => !m.isRead).length,
          `种子 ${seed} 第 ${i} 步：拉取后计数不一致`
        );
      }
    } catch (error) {
      // 领域拒绝是预期路径，但必须零副作用
      assert(error instanceof DomainError, `种子 ${seed} 第 ${i} 步：抛出了非领域异常 ${String(error)}`);
      const after = snapshotOf(world);
      assertEqual(after.exchangeStatuses, before.exchangeStatuses,
        `种子 ${seed} 第 ${i} 步：被拒绝的操作改动了交换状态`);
      assertEqual(after.messageCount, before.messageCount,
        `种子 ${seed} 第 ${i} 步：被拒绝的操作改动了通知集合`);
      assertEqual(after.readFlags, before.readFlags,
        `种子 ${seed} 第 ${i} 步：被拒绝的操作改动了已读标记`);
    }
    assertWorldInvariants(world, `种子 ${seed} 第 ${i} 步`);
  }
};

suite('随机乱序操作序列下的全局一致性', () => {
  test('多个确定性种子的长操作序列均保持全部不变量', () => {
    const seeds = [20260928, 7, 123456789];
    for (const seed of seeds) {
      runRandomSequence(seed, 300);
    }
  });
});
