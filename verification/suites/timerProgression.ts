import { Suite, createTestRoom } from '../harness';

export function timerProgressionSuite(suite: Suite): void {
  const { room, scheduler, users, sockets } = createTestRoom({ seed: 5, userCount: 2 });
  const [userA, userB] = users;
  const socket = sockets[0];

  room.startGame();
  suite.assertEqual('开局广播 GAME_STARTING', socket.ofType('GAME_STARTING').length, 1);

  scheduler.advance(2999);
  suite.assertEqual('倒计时未到时不出题', socket.ofType('QUESTION').length, 0);
  scheduler.advance(1);
  suite.assertEqual('倒计时结束进入第 0 题', room.currentQuestion, 0);
  suite.assertEqual('第 0 题广播一次', socket.ofType('QUESTION').length, 1);

  scheduler.advance(15000);
  suite.assertEqual('超时后广播全员作答汇总', socket.ofType('ALL_ANSWERS').length, 1);
  suite.assertEqual('未作答用户在汇总中记为 -1', socket.ofType('ALL_ANSWERS')[0].payload.answers.map(a => a.answer), [-1, -1]);

  scheduler.advance(1999);
  suite.assertEqual('展示窗口未结束不推进', room.currentQuestion, 0);
  scheduler.advance(1);
  suite.assertEqual('展示窗口结束推进到第 1 题', room.currentQuestion, 1);
  suite.assertEqual('超时路径不重复广播汇总', socket.ofType('ALL_ANSWERS').length, 1);

  room.submitAnswer(userA.id, 1, 0, 600);
  suite.assertEqual('部分作答不触发提前汇总', socket.ofType('ALL_ANSWERS').length, 1);
  room.submitAnswer(userB.id, 1, 0, 700);
  suite.assertEqual('全员提前作答立即汇总', socket.ofType('ALL_ANSWERS').length, 2);

  scheduler.advance(15000);
  suite.assertEqual('提前收齐后原问题计时器不再触发', socket.ofType('ALL_ANSWERS').length, 2);
  scheduler.advance(2000);
  suite.assertEqual('提前收齐后恰好推进一题', room.currentQuestion, 2);
  suite.assertEqual('提前收齐路径不重复出题', socket.ofType('QUESTION').length, 3);

  for (let idx = 2; idx < room.questions.length; idx++) {
    room.submitAnswer(userA.id, idx, idx % 4, 400);
    room.submitAnswer(userB.id, idx, idx % 4, 500);
    scheduler.advance(2000);
  }

  suite.assertEqual('十题全部出完，无漏推进', socket.ofType('QUESTION').length, 10);
  suite.assertEqual('每题恰好一次作答汇总', socket.ofType('ALL_ANSWERS').length, 10);
  suite.assertEqual('对局状态为已结束', room.status, 'finished');
  suite.assertEqual('结束广播 MATCH_RESULT 恰好一次', socket.ofType('MATCH_RESULT').length, 1);
  suite.assertEqual('两个客户端都收到结果', sockets[1].ofType('MATCH_RESULT').length, 1);
  suite.assertEqual('结束后无残留计时任务', scheduler.pendingCount, 0);

  const questionIndexes = socket.ofType('QUESTION').map(m => m.payload.index);
  suite.assertEqual('题目按 0-9 顺序依次推进', questionIndexes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  scheduler.advance(60000);
  suite.assertEqual('结束后推进时间不再产生任何广播', socket.ofType('QUESTION').length, 10);
}
