import { suite, test, assert, assertEqual, assertThrows } from './harness';
import { buildWorld } from './fixtures';
import { assertWorldInvariants } from './invariants';
import { DomainError } from '../services/exchangeService';

const isDomainError = (code: number) => (e: unknown) =>
  e instanceof DomainError && e.statusCode === code;

suite('交换状态流转与通知标记一致性', () => {
  test('完整生命周期 pending->approved->completed 每步标记都与记录一致', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;

    const { exchange, notification } = service.createExchange({
      bookId: ownerBook.id,
      requesterId: requester.id,
    });
    assertEqual(exchange.status, 'pending', '新建交换应为 pending');
    assertEqual(notification.exchangeStatus, 'pending', '申请通知应携带 pending 标记');
    assertWorldInvariants(world, '创建后');

    const approved = service.updateExchangeStatus({
      exchangeId: exchange.id,
      status: 'approved',
      actorId: owner.id,
    });
    assert(approved.changed, '首次接受应产生状态变更');
    assertEqual(approved.notification?.exchangeStatus, 'approved', '更新通知应携带 approved 标记');
    assertWorldInvariants(world, '接受后');

    const completed = service.updateExchangeStatus({
      exchangeId: exchange.id,
      status: 'completed',
      actorId: requester.id,
    });
    assertEqual(completed.notification?.exchangeStatus, 'completed', '完成通知应携带 completed 标记');
    assertWorldInvariants(world, '完成后');

    const markers = service.getNotificationsForExchange(exchange.id).map((n) => n.exchangeStatus);
    assertEqual(JSON.stringify(markers), JSON.stringify(['pending', 'approved', 'completed']),
      '通知标记序列应完整记录状态历史');
  });

  test('重复处理同一申请是幂等 no-op，不产生重复通知', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const { exchange } = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id });

    service.updateExchangeStatus({ exchangeId: exchange.id, status: 'approved', actorId: owner.id });
    const msgCount = world.messages.length;

    const dup = service.updateExchangeStatus({
      exchangeId: exchange.id,
      status: 'approved',
      actorId: owner.id,
    });
    assert(!dup.changed, '重复提交相同状态不应视为变更');
    assertEqual(dup.notification, null, '重复提交不应产生新通知');
    assertEqual(world.messages.length, msgCount, '重复提交不应增加通知');
    assertEqual(world.service.findExchange(exchange.id)?.status, 'approved', '状态应保持 approved');
    assertWorldInvariants(world, '重复处理后');
  });

  test('状态回退与非法跳转被拒绝且不留副作用', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook } = world;
    const { exchange } = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id });
    service.updateExchangeStatus({ exchangeId: exchange.id, status: 'approved', actorId: owner.id });
    service.updateExchangeStatus({ exchangeId: exchange.id, status: 'completed', actorId: owner.id });
    const msgCount = world.messages.length;

    const attempts = ['pending', 'approved', 'rejected', 'cancelled'] as const;
    for (const target of attempts) {
      assertThrows(
        () => service.updateExchangeStatus({ exchangeId: exchange.id, status: target, actorId: owner.id }),
        isDomainError(409),
        `终态 completed 不允许变更为 ${target}`
      );
    }
    assertEqual(world.messages.length, msgCount, '非法流转不应产生通知');
    assertEqual(world.service.findExchange(exchange.id)?.status, 'completed', '终态不应被回退');
    assertWorldInvariants(world, '回退尝试后');
  });

  test('rejected 与 cancelled 均为终态，不可再被处理', () => {
    const world = buildWorld();
    const { service, owner, requester, ownerBook, requesterBook } = world;

    const rejected = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }).exchange;
    service.updateExchangeStatus({ exchangeId: rejected.id, status: 'rejected', actorId: owner.id });
    assertThrows(
      () => service.updateExchangeStatus({ exchangeId: rejected.id, status: 'approved', actorId: owner.id }),
      isDomainError(409),
      'rejected 之后不允许再接受'
    );

    const cancelled = service.createExchange({ bookId: requesterBook.id, requesterId: owner.id }).exchange;
    service.updateExchangeStatus({ exchangeId: cancelled.id, status: 'cancelled', actorId: owner.id });
    assertThrows(
      () => service.updateExchangeStatus({ exchangeId: cancelled.id, status: 'approved', actorId: requester.id }),
      isDomainError(409),
      'cancelled 之后不允许再接受'
    );
    assertWorldInvariants(world, '终态保护后');
  });

  test('非法状态值、无权操作、申请不存在分别被拒绝', () => {
    const world = buildWorld();
    const { service, owner, requester, outsider, ownerBook } = world;
    const { exchange } = service.createExchange({ bookId: ownerBook.id, requesterId: requester.id });

    assertThrows(
      () => service.updateExchangeStatus({
        exchangeId: exchange.id,
        status: 'bogus' as never,
        actorId: owner.id,
      }),
      isDomainError(400),
      '非法状态值应返回 400'
    );
    assertThrows(
      () => service.updateExchangeStatus({ exchangeId: exchange.id, status: 'approved', actorId: outsider.id }),
      isDomainError(403),
      '非当事人操作应返回 403'
    );
    assertThrows(
      () => service.updateExchangeStatus({ exchangeId: 'no-such-id', status: 'approved', actorId: owner.id }),
      isDomainError(404),
      '申请不存在应返回 404'
    );
    assertThrows(
      () => service.createExchange({ bookId: ownerBook.id, requesterId: requester.id }),
      isDomainError(400),
      '同一书籍的重复 pending 申请应被拒绝'
    );
    assertWorldInvariants(world, '非法输入后');
  });
});
