import { suite, test, assert, assertEqual } from './harness';
import { buildWorld } from './fixtures';
import { assertWorldInvariants } from './invariants';

suite('同一申请多条通知的隔离性', () => {
  test('标记其中一条已读不影响同申请的其它通知', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const ex = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;
    service.updateExchangeStatus({ exchangeId: ex.id, status: 'approved', actorId: owner.id });
    service.updateExchangeStatus({ exchangeId: ex.id, status: 'completed', actorId: owner.id });

    const notifs = service.getNotificationsForExchange(ex.id);
    assertEqual(notifs.length, 3, '该申请应累积 3 条通知');

    // requester 收到 approved/completed 两条更新通知，只读其中一条
    const requesterNotifs = notifs.filter((n) => n.receiverId === requester.id);
    assertEqual(requesterNotifs.length, 2, 'requester 应收到 2 条更新通知');
    service.markMessageRead(requester.id, requesterNotifs[0]!.id);

    const after = service.getNotificationsForExchange(ex.id);
    const first = after.find((n) => n.id === requesterNotifs[0]!.id)!;
    const second = after.find((n) => n.id === requesterNotifs[1]!.id)!;
    assert(first.isRead, '被标记的通知应为已读');
    assert(!second.isRead, '同申请的另一条通知不应被连带标记');
    assertEqual(second.exchangeStatus, 'completed', '另一条通知的状态标记不应被改写');
    assertEqual(service.getUnreadCount(requester.id), 1, '未读计数应只减一');
    assertWorldInvariants(world, '单条已读后');
  });

  test('状态更新不会改写历史通知的标记', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const ex = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;
    service.updateExchangeStatus({ exchangeId: ex.id, status: 'approved', actorId: owner.id });
    const snapshot = service.getNotificationsForExchange(ex.id).map((n) => ({
      id: n.id,
      marker: n.exchangeStatus,
    }));

    service.updateExchangeStatus({ exchangeId: ex.id, status: 'completed', actorId: owner.id });
    const after = service.getNotificationsForExchange(ex.id);
    for (const prev of snapshot) {
      const current = after.find((n) => n.id === prev.id)!;
      assertEqual(current.exchangeStatus, prev.marker,
        `历史通知 ${prev.id} 的标记不应被后续流转覆盖`);
    }
    assertWorldInvariants(world, '历史标记保护');
  });

  test('一方的全部已读不清空另一方在同一申请上的通知', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const ex = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;
    service.updateExchangeStatus({ exchangeId: ex.id, status: 'approved', actorId: owner.id });

    service.markAllMessagesRead(owner.id);
    const requesterNotifs = service.getMessagesForUser(requester.id);
    assert(requesterNotifs.every((m) => !m.isRead), 'requester 的通知不应被 owner 的操作影响');
    assertEqual(service.getUnreadCount(requester.id), 1, 'requester 未读应保持不变');
    assertEqual(service.getUnreadCount(owner.id), 0, 'owner 应已全部已读');
    assertWorldInvariants(world, '单方全部已读后');
  });
});
