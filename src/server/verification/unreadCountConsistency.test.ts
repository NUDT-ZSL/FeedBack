import { suite, test, assert, assertEqual, assertThrows } from './harness';
import { buildWorld } from './fixtures';
import { assertWorldInvariants } from './invariants';
import { DomainError } from '../services/exchangeService';

suite('未读计数与通知集合一致性', () => {
  test('重新拉取、逐条已读、全部已读各阶段计数都与集合吻合', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook, requesterBook } = world;

    // 构造双向多条通知：requester 向 owner 申请，owner 也向 requester 申请
    const ex1 = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;
    const ex2 = service.createExchange({ bookId: requesterBook.id, requesterId: owner.id }).exchange;
    service.updateExchangeStatus({ exchangeId: ex1.id, status: 'approved', actorId: owner.id });
    service.updateExchangeStatus({ exchangeId: ex2.id, status: 'rejected', actorId: requester.id });

    // 重新拉取列表，计数与集合推导一致
    const ownerMsgs = service.getMessagesForUser(owner.id);
    assertEqual(service.getUnreadCount(owner.id), ownerMsgs.filter((m) => !m.isRead).length,
      '拉取列表推导的未读数应与计数接口一致');
    assertEqual(service.getUnreadCount(owner.id), 2, 'owner 应有 2 条未读（申请+被拒绝通知）');
    assertEqual(service.getUnreadCount(requester.id), 2, 'requester 应有 2 条未读');

    // 逐条标记已读：每读一条计数减一
    service.markMessageRead(owner.id, ownerMsgs[0]!.id);
    assertEqual(service.getUnreadCount(owner.id), 1, '标记一条后未读应减一');
    // 重复标记同一条是幂等的
    service.markMessageRead(owner.id, ownerMsgs[0]!.id);
    assertEqual(service.getUnreadCount(owner.id), 1, '重复标记不应再次减计数');

    // 全部已读后归零，另一用户不受影响
    service.markAllMessagesRead(owner.id);
    assertEqual(service.getUnreadCount(owner.id), 0, '全部已读后计数应为 0');
    assertEqual(service.getUnreadCount(requester.id), 2, '他人的未读不应受影响');

    // 全部已读之后再拉取，新到通知仍正确计数
    service.updateExchangeStatus({ exchangeId: ex1.id, status: 'completed', actorId: requester.id });
    assertEqual(service.getUnreadCount(owner.id), 1, '新通知到达后计数应为 1');
    assertWorldInvariants(world, '未读计数全流程');
  });

  test('标记不存在的消息返回 404 且不改变任何计数', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    service.createExchange({ bookId: ownerBook.id, requesterId: requester.id });
    const before = service.getUnreadCount(owner.id);

    assertThrows(
      () => service.markMessageRead(owner.id, 'no-such-message'),
      (e) => e instanceof DomainError && e.statusCode === 404,
      '标记不存在的消息应返回 404'
    );
    // 不能越权标记他人的消息
    const ownerMsg = service.getMessagesForUser(owner.id)[0]!;
    assertThrows(
      () => service.markMessageRead(requester.id, ownerMsg.id),
      (e) => e instanceof DomainError && e.statusCode === 404,
      '不能标记他人消息'
    );
    assertEqual(service.getUnreadCount(owner.id), before, '失败操作不应改变计数');
    assertWorldInvariants(world, '异常标记后');
  });

  test('交替进行拉取与已读操作，计数始终与集合吻合', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const ex = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;

    // 交错执行：拉取 -> 读一条 -> 新通知 -> 再拉取 -> 全部已读
    let fetched = service.getMessagesForUser(owner.id);
    service.markMessageRead(owner.id, fetched[0]!.id);
    service.updateExchangeStatus({ exchangeId: ex.id, status: 'approved', actorId: owner.id });
    fetched = service.getMessagesForUser(owner.id);
    assertEqual(service.getUnreadCount(owner.id), fetched.filter((m) => !m.isRead).length,
      '交错操作后计数应与集合一致');
    service.markAllMessagesRead(owner.id);
    assertEqual(service.getUnreadCount(owner.id), 0, '全部已读后应为 0');
    assertWorldInvariants(world, '交错操作后');
  });
});
