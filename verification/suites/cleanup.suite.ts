import { suite, test, assert, assertEqual } from '../harness.ts';
import { createScriptedRoom, countBroadcasts } from '../fakes.ts';

suite('类别五：房间清理与销毁后计时隔离', () => {
  test('对局进行中全部离开并销毁后，残留计时不再广播', () => {
    const { room, manager, scheduler, users, sockets } = createScriptedRoom(55, ['小明', '小红']);
    room.startGame();
    scheduler.advance(3000);
    room.submitAnswer(users[0].id, 0, 1, 1000);
    scheduler.advance(17000);
    assertEqual(room.currentQuestion, 1, '前置条件：应已推进到第 1 题');

    const messagesBefore = [...sockets.values()].reduce((sum, socket) => sum + socket.messages.length, 0);

    users.forEach(user => room.removeUser(user.id));
    assertEqual(manager.deleteRoom('TEST'), true, 'deleteRoom 应返回 true');
    assertEqual(manager.getRoom('TEST'), undefined, '房间应已从管理器移除');
    assertEqual(scheduler.pendingCount, 0, '销毁时必须清空全部残留计时');

    scheduler.advance(120000);
    const messagesAfter = [...sockets.values()].reduce((sum, socket) => sum + socket.messages.length, 0);
    assertEqual(messagesAfter, messagesBefore, '房间销毁后残留计时不允许再触发任何广播');
    assertEqual(countBroadcasts(sockets, 'MATCH_RESULT'), 0, '销毁的房间不允许补发最终结果');
  });

  test('开局倒计时期间销毁不会再出题', () => {
    const { room, manager, scheduler, sockets } = createScriptedRoom(56, ['小明', '小红']);
    room.startGame();
    scheduler.advance(1000);
    manager.deleteRoom('TEST');
    scheduler.advance(20000);
    assertEqual(countBroadcasts(sockets, 'QUESTION'), 0, '销毁后开局倒计时不允许触发出题');
  });

  test('重复销毁房间是幂等的', () => {
    const { manager } = createScriptedRoom(57, ['小明', '小红']);
    assertEqual(manager.deleteRoom('TEST'), true, '首次销毁返回 true');
    assertEqual(manager.deleteRoom('TEST'), false, '再次销毁返回 false 且不报错');
  });

  test('getOrCreateRoom 销毁后再获取得到全新房间', () => {
    const { room, manager } = createScriptedRoom(58, ['小明', '小红']);
    assertEqual(manager.getOrCreateRoom('TEST'), room, '房间存在时应直接复用');
    manager.deleteRoom('TEST');
    const recreated = manager.getOrCreateRoom('TEST');
    assert(recreated !== room, '销毁后应得到全新的房间实例');
    assertEqual(recreated.status, 'waiting', '新房间应处于等待状态');
    assertEqual(recreated.users.length, 0, '新房间不应残留旧用户');
  });
});
