import { suite, test, assertEqual } from '../harness.ts';
import { createScriptedRoom, countBroadcasts } from '../fakes.ts';
import type { ServerMessage } from '../../shared/types.ts';

function messagesOf<T extends ServerMessage['type']>(
  sockets: Map<string, import('../fakes.ts').MockWebSocket>,
  type: T
): Extract<ServerMessage, { type: T }>[] {
  const collected: Extract<ServerMessage, { type: T }>[] = [];
  for (const socket of sockets.values()) {
    socket.ofType(type).forEach(message => collected.push(message as Extract<ServerMessage, { type: T }>));
  }
  return collected;
}

suite('类别四：手动驱动下的计时推进', () => {
  test('开局倒计时走完后才广播第一题', () => {
    const { room, scheduler, sockets } = createScriptedRoom(99, ['小明', '小红']);
    room.startGame();
    assertEqual(countBroadcasts(sockets, 'GAME_STARTING'), 2, '开局应广播 GAME_STARTING');
    scheduler.advance(2999);
    assertEqual(countBroadcasts(sockets, 'QUESTION'), 0, '倒计时未结束不应出题');
    scheduler.advance(1);
    const questions = messagesOf(sockets, 'QUESTION');
    assertEqual(questions.length, 2, '3 秒后应向两名用户各广播一次题目');
    assertEqual(questions[0].payload.index, 0, '第一题的题号应为 0');
  });

  test('提前收齐作答后恰好揭晓一次并进入下一题', () => {
    const { room, scheduler, users, sockets } = createScriptedRoom(99, ['小明', '小红']);
    room.startGame();
    scheduler.advance(3000);

    room.submitAnswer(users[0].id, 0, 1, 1000);
    room.submitAnswer(users[1].id, 0, 2, 1000);

    const reveal0 = messagesOf(sockets, 'ALL_ANSWERS').filter(m => m.payload.questionIndex === 0);
    assertEqual(reveal0.length, 2, '第 0 题收齐后应向两名用户各揭晓一次');

    scheduler.advance(1999);
    assertEqual(countBroadcasts(sockets, 'QUESTION'), 2, '揭晓间隙不应提前进入下一题');
    scheduler.advance(1);
    const question1 = messagesOf(sockets, 'QUESTION').filter(m => m.payload.index === 1);
    assertEqual(question1.length, 2, '2 秒后应进入第 1 题');

    scheduler.advance(15000);
    const question1Again = messagesOf(sockets, 'QUESTION').filter(m => m.payload.index === 1);
    assertEqual(question1Again.length, 2, '第 1 题不允许被重复推进广播');
  });

  test('超时收齐作答后恰好揭晓一次', () => {
    const { room, scheduler, sockets } = createScriptedRoom(99, ['小明', '小红']);
    room.startGame();
    scheduler.advance(3000);

    scheduler.advance(14999);
    assertEqual(
      messagesOf(sockets, 'ALL_ANSWERS').filter(m => m.payload.questionIndex === 0).length,
      0,
      '15 秒未到不应揭晓'
    );
    scheduler.advance(1);
    assertEqual(
      messagesOf(sockets, 'ALL_ANSWERS').filter(m => m.payload.questionIndex === 0).length,
      2,
      '15 秒到点应超时揭晓'
    );

    scheduler.advance(2000);
    assertEqual(
      messagesOf(sockets, 'QUESTION').filter(m => m.payload.index === 1).length,
      2,
      '超时揭晓 2 秒后应进入下一题'
    );
  });

  test('揭晓后的迟到作答不会导致重复推进', () => {
    const { room, scheduler, users, sockets } = createScriptedRoom(99, ['小明', '小红']);
    room.startGame();
    scheduler.advance(3000);

    scheduler.advance(15000);
    const answersBefore = users[0].answers.length;
    room.submitAnswer(users[0].id, 0, 1, 15000);
    room.submitAnswer(users[1].id, 0, 2, 15000);
    assertEqual(users[0].answers.length, answersBefore, '揭晓后的作答不允许写入');

    scheduler.advance(2000);
    const question1 = messagesOf(sockets, 'QUESTION').filter(m => m.payload.index === 1);
    assertEqual(question1.length, 2, '迟到作答不允许导致重复进入下一题');
    assertEqual(
      messagesOf(sockets, 'ALL_ANSWERS').filter(m => m.payload.questionIndex === 0).length,
      2,
      '第 0 题不允许重复揭晓'
    );
  });

  test('逐题推进直至结束，每题恰好一次且无残留计时', () => {
    const { room, scheduler, users, sockets } = createScriptedRoom(99, ['小明', '小红']);
    room.startGame();
    scheduler.advance(3000);

    for (let qi = 0; qi < 10; qi++) {
      assertEqual(room.currentQuestion, qi, `应逐题推进到第 ${qi} 题`);
      if (qi % 2 === 0) {
        room.submitAnswer(users[0].id, qi, 0, 1000);
        room.submitAnswer(users[1].id, qi, 1, 1000);
      }
      scheduler.advance(17000);
      if (qi < 9) {
        assertEqual(room.currentQuestion, qi + 1, `推进后题号应变为 ${qi + 1}`);
      }
    }

    assertEqual(room.status, 'finished', '10 题后对局应结束');
    for (let qi = 0; qi < 10; qi++) {
      const count = messagesOf(sockets, 'QUESTION').filter(m => m.payload.index === qi).length;
      assertEqual(count, 2, `第 ${qi} 题应恰好广播给两名用户各一次`);
      const revealCount = messagesOf(sockets, 'ALL_ANSWERS').filter(m => m.payload.questionIndex === qi).length;
      assertEqual(revealCount, 2, `第 ${qi} 题应恰好揭晓给两名用户各一次`);
    }
    assertEqual(countBroadcasts(sockets, 'MATCH_RESULT'), 2, '结束时应恰好广播一次最终结果');

    const messagesBefore = [...sockets.values()].reduce((sum, socket) => sum + socket.messages.length, 0);
    scheduler.advance(120000);
    const messagesAfter = [...sockets.values()].reduce((sum, socket) => sum + socket.messages.length, 0);
    assertEqual(messagesAfter, messagesBefore, '对局结束后计时不允许再触发广播');
    assertEqual(scheduler.pendingCount, 0, '对局结束后不允许残留计时任务');
  });
});
