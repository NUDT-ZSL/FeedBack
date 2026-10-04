import { Suite, createTestRoom } from '../harness';

export function answerSubmissionSuite(suite: Suite): void {
  const { room, scheduler, users } = createTestRoom({ seed: 11, userCount: 2 });
  const [userA, userB] = users;

  room.startGame();
  scheduler.advance(3000);
  suite.assertEqual('开局倒计时后进入第 0 题', room.currentQuestion, 0);

  room.submitAnswer(userA.id, 0, 1, 800);
  room.submitAnswer(userA.id, 0, 2, 900);
  suite.assertEqual('重复提交同一题只保留首次作答', userA.answers.length, 1);
  suite.assertEqual('重复提交不覆盖已记录的答案', userA.answers[0].answer, 1);

  room.submitAnswer(userA.id, 5, 3, 800);
  room.submitAnswer(userA.id, -1, 3, 800);
  suite.assertEqual('越界题号提交不产生作答记录', userA.answers.length, 1);

  room.submitAnswer('not-a-member', 0, 2, 800);
  suite.assertEqual('未加入房间的用户提交不影响他人作答', userB.answers.length, 0);
  suite.assertEqual('未加入房间的用户提交不污染已有作答', userA.answers.length, 1);

  room.submitAnswer(userB.id, 0, 1, 1200);
  scheduler.advance(2000);
  suite.assertEqual('全员作答后正常进入下一题', room.currentQuestion, 1);

  for (let idx = 1; idx < room.questions.length; idx++) {
    room.submitAnswer(userA.id, idx, idx % 4, 500);
    room.submitAnswer(userB.id, idx, (idx + 1) % 4, 700);
    scheduler.advance(2000);
  }

  suite.assertEqual('全部题目完成后对局结束', room.status, 'finished');

  const matchesBefore = room.calculateMatches();
  const answersSnapshot = users.map(u => u.answers.map(a => ({ ...a })));

  room.submitAnswer(userA.id, 0, 3, 100);
  room.submitAnswer(userB.id, 9, 3, 100);
  room.submitAnswer('not-a-member', 0, 0, 100);

  suite.assertEqual(
    '对局结束后提交不污染任何作答记录',
    users.map(u => u.answers),
    answersSnapshot
  );
  suite.assertEqual('对局结束后提交不影响最终匹配结果', room.calculateMatches(), matchesBefore);

  const late = createTestRoom({ seed: 11, userCount: 2 });
  const [lateA, lateB] = late.users;
  late.room.startGame();
  late.scheduler.advance(3000);
  late.room.submitAnswer(lateA.id, 0, 1, 500);
  late.scheduler.advance(15000);
  suite.assertEqual('超时后进入展示窗口仍未推进', late.room.currentQuestion, 0);

  late.room.submitAnswer(lateB.id, 0, 2, 16000);
  suite.assertEqual('超时展示窗口内的迟到提交被拒绝', lateB.answers.length, 0);

  const questionBroadcastsBefore = late.sockets[0].ofType('QUESTION').length;
  late.scheduler.advance(2000);
  suite.assertEqual('展示窗口结束后恰好推进一题', late.room.currentQuestion, 1);
  suite.assertEqual(
    '迟到提交不触发额外推进',
    late.sockets[0].ofType('QUESTION').length - questionBroadcastsBefore,
    1
  );
}
