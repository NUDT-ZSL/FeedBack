import { assert, assertEqual } from './harness';
import { isAllowedTransition, isValidStatus } from '../services/exchangeService';
import { World } from './fixtures';

/**
 * 全局不变量，任何操作序列执行后都必须成立：
 * 1. 每条交换记录的通知标记序列是从 pending 出发的合法流转路径，
 *    且最新一条通知的标记与交换记录当前状态一致；
 * 2. 每个用户的未读计数与其通知集合中的实际未读条数吻合，
 *    重新拉取的列表与集合一致；
 * 3. 通知 id 全局唯一，不存在静默覆盖或丢失。
 */
export const assertWorldInvariants = (world: World, label: string): void => {
  for (const exchange of world.exchanges) {
    const notifs = world.messages.filter((m) => m.relatedExchangeId === exchange.id);
    assert(notifs.length >= 1, `[${label}] 交换 ${exchange.id} 至少应有申请通知`);

    const markers = notifs.map((n) => n.exchangeStatus);
    markers.forEach((marker, i) => {
      assert(isValidStatus(marker), `[${label}] 通知 ${notifs[i].id} 缺少合法状态标记`);
    });
    assertEqual(markers[0], 'pending', `[${label}] 交换 ${exchange.id} 的首条通知标记应为 pending`);
    for (let i = 1; i < markers.length; i += 1) {
      assert(
        isAllowedTransition(markers[i - 1]!, markers[i]!),
        `[${label}] 交换 ${exchange.id} 的通知标记出现非法流转 ${markers[i - 1]} -> ${markers[i]}`
      );
    }
    assertEqual(
      markers[markers.length - 1],
      exchange.status,
      `[${label}] 交换 ${exchange.id} 的最新通知标记与记录状态不一致`
    );
  }

  for (const user of world.users) {
    const actualUnread = world.messages.filter((m) => m.receiverId === user.id && !m.isRead).length;
    assertEqual(
      world.service.getUnreadCount(user.id),
      actualUnread,
      `[${label}] 用户 ${user.id} 的未读计数与集合实际未读数不符`
    );
    const fetched = world.service.getMessagesForUser(user.id);
    assertEqual(
      fetched.length,
      world.messages.filter((m) => m.receiverId === user.id).length,
      `[${label}] 用户 ${user.id} 重新拉取的通知列表与集合不一致`
    );
    assertEqual(
      fetched.filter((m) => !m.isRead).length,
      actualUnread,
      `[${label}] 用户 ${user.id} 拉取列表推导的未读数不符`
    );
  }

  const ids = new Set(world.messages.map((m) => m.id));
  assertEqual(ids.size, world.messages.length, `[${label}] 通知 id 出现重复，存在覆盖风险`);
};
