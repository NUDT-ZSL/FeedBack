import { Suite, createTestRoom } from '../harness';

export function roomCleanupSuite(suite: Suite): void {
  const { manager, room, scheduler, users, sockets } = createTestRoom({ seed: 9, userCount: 2 });

  room.startGame();
  scheduler.advance(3000 + 5000);
  suite.assertEqual('对局进行中存在待触发计时任务', scheduler.pendingCount > 0, true);

  room.removeUser(users[0].id);
  room.removeUser(users[1].id);
  suite.assertEqual('全部用户离开后房间无用户', room.users.length, 0);

  const deleted = manager.deleteRoom(room.id);
  suite.check('全部用户离开后房间被清理', deleted && manager.getRoom(room.id) === undefined);
  suite.assertEqual('清理后无残留计时任务', scheduler.pendingCount, 0);

  const messageCounts = sockets.map(s => s.messages.length);
  scheduler.runAll();
  scheduler.advance(60000);
  suite.assertEqual(
    '房间销毁后残留计时不触发任何广播',
    sockets.map(s => s.messages.length),
    messageCounts
  );

  const second = createTestRoom({ seed: 9, userCount: 2, roomId: 'SECOND' });
  second.room.startGame();
  second.scheduler.advance(3000);
  second.room.submitAnswer(second.users[0].id, 0, 1, 500);
  second.room.submitAnswer(second.users[1].id, 0, 1, 600);
  const countsBeforeDelete = second.sockets.map(s => s.messages.length);
  second.manager.deleteRoom('SECOND');
  second.scheduler.runAll();
  suite.assertEqual(
    '提前收齐后的推进计时在销毁后不再广播',
    second.sockets.map(s => s.messages.length),
    countsBeforeDelete
  );
  suite.assertEqual('第二个房间销毁后同样无残留计时', second.scheduler.pendingCount, 0);

  const third = createTestRoom({ seed: 9, userCount: 2, roomId: 'THIRD' });
  third.manager.deleteRoom('THIRD');
  let broadcastThrew = false;
  try {
    third.room.broadcast({ type: 'USER_LEFT', payload: { userId: 'x' } });
    third.room.startGame();
  } catch {
    broadcastThrew = true;
  }
  suite.check('销毁后的房间调用广播与开局不抛异常', !broadcastThrew);
  suite.assertEqual('销毁后开局不产生计时任务', third.scheduler.pendingCount, 0);
}
