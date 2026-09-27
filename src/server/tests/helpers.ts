import { ExchangeNotificationStore, checkInvariants } from '../services/exchangeDomain';

export interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
}

const registry: TestCase[] = [];

export function test(suite: string, name: string, fn: () => void | Promise<void>): void {
  registry.push({ suite, name, fn });
}

export function getTests(): TestCase[] {
  return registry;
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

export function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败: ${msg}（期望 ${String(expected)}，实际 ${String(actual)}）`);
  }
}

/** 确定性 id 生成器，保证用例可重复执行 */
export function makeIdGen(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `${prefix}-t${++n}`;
}

export function makeStore(): ExchangeNotificationStore {
  return new ExchangeNotificationStore(makeIdGen());
}

/** 直接从通知集合数出的未读数（独立于 store 自身实现，用于交叉验证） */
export function manualUnread(store: ExchangeNotificationStore, userId: string): number {
  return store.messages.filter((m) => m.receiverId === userId && !m.isRead).length;
}

/** 断言交换记录与通知状态标记等不变量全部成立 */
export function assertConsistent(store: ExchangeNotificationStore): void {
  const violations = checkInvariants(store);
  assert(violations.length === 0, `一致性违规:\n  ${violations.join('\n  ')}`);
}

/** 断言每个用户的未读数都与通知集合实际未读条目吻合 */
export function assertUnreadMatches(store: ExchangeNotificationStore, userIds: string[]): void {
  for (const uid of userIds) {
    assertEqual(store.getUnreadCount(uid), manualUnread(store, uid), `用户 ${uid} 的未读数与通知集合不符`);
  }
}
