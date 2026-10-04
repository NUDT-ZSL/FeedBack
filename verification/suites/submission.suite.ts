import { suite, test, assert, assertEqual, assertDeepEqual } from '../harness.ts';
import { createScriptedRoom, playToCompletion, normalizeMatchResult, countBroadcasts } from '../fakes.ts';
import type { ServerMessage } from '../../shared/types.ts';

const SEED = 31415;

function startRoom(names: string[] = ['小明', '小红']) {
  const ctx = createScriptedRoom(SEED, names);
  ctx.room.startGame();
  ctx.scheduler.advance(3000);
  assertEqual(ctx.room.currentQuestion, 0, '开局倒计时后应进入第 0 题');
  return ctx;
}

function validAnswerFor(questionIndex: number): number {
  return questionIndex % 4;
}

function playRestOfGame(ctx: ReturnType<typeof startRoom>): void {
  playToCompletion(ctx.room, ctx.scheduler, (_user, qi) => validAnswerFor(qi));
}

suite('类别三：作答提交链路健壮性', () => {
  test('重复提交同一题只保留首次作答', () => {
    const { room, users } = startRoom();
    room.submitAnswer(users[0].id, 0, 1, 1200);
    room.submitAnswer(users[0].id, 0, 3, 5000);
    room.submitAnswer(users[0].id, 0, 0, 8000);
    const recorded = users[0].answers.filter(a => a.questionIndex === 0);
    assertEqual(recorded.length, 1, '同一题只允许记录一次作答');
    assertEqual(recorded[0].answer, 1, '必须保留首次提交的答案');
    assertEqual(recorded[0].timeSpent, 1200, '必须保留首次提交的耗时');
  });

  test('提交越界题号不污染作答记录', () => {
    const { room, users } = startRoom();
    room.submitAnswer(users[0].id, 5, 1, 1000);
    room.submitAnswer(users[0].id, -1, 1, 1000);
    room.submitAnswer(users[0].id, 99, 1, 1000);
    assertEqual(users[0].answers.length, 0, '越界题号不允许写入作答记录');
  });

  test('未加入房间的用户提交被忽略', () => {
    const { room, users } = startRoom();
    room.submitAnswer('ghost-user-id', 0, 1, 1000);
    users.forEach(user => {
      assertEqual(user.answers.length, 0, '幽灵用户提交不允许影响任何用户的作答');
    });
    assertEqual(room.currentQuestion, 0, '幽灵用户提交不允许推进题目');
  });

  test('对局结束后提交不修改任何记录', () => {
    const ctx = startRoom();
    playRestOfGame(ctx);
    assertEqual(ctx.room.status, 'finished', '对局应已结束');
    const snapshot = JSON.stringify(ctx.users.map(u => u.answers));
    const broadcastsBefore = countBroadcasts(ctx.sockets, 'ALL_ANSWERS') + countBroadcasts(ctx.sockets, 'MATCH_RESULT');

    ctx.room.submitAnswer(ctx.users[0].id, 0, 2, 1000);
    ctx.room.submitAnswer(ctx.users[1].id, 9, 1, 1000);
    ctx.scheduler.advance(60000);

    assertEqual(JSON.stringify(ctx.users.map(u => u.answers)), snapshot, '结束后提交不允许修改作答记录');
    const broadcastsAfter = countBroadcasts(ctx.sockets, 'ALL_ANSWERS') + countBroadcasts(ctx.sockets, 'MATCH_RESULT');
    assertEqual(broadcastsAfter, broadcastsBefore, '结束后提交不允许触发新的广播');
  });

  test('夹杂无效提交的对局与干净对局最终结果一致', () => {
    const clean = startRoom();
    playRestOfGame(clean);

    const polluted = startRoom();
    const { room, users, scheduler } = polluted;
    room.submitAnswer(users[0].id, 0, validAnswerFor(0), 1000);
    room.submitAnswer(users[0].id, 0, 3, 9000);
    room.submitAnswer(users[0].id, 7, 2, 1000);
    room.submitAnswer('ghost', 0, 2, 1000);
    room.submitAnswer(users[1].id, 0, validAnswerFor(0), 1000);
    playToCompletion(room, scheduler, (_user, qi) => validAnswerFor(qi));
    room.submitAnswer(users[0].id, 3, 1, 1000);

    assertEqual(polluted.room.status, 'finished', '污染对局应正常结束');
    assertEqual(clean.room.status, 'finished', '干净对局应正常结束');

    const cleanResult = lastMatchResult(clean.sockets, clean.room);
    const pollutedResult = lastMatchResult(polluted.sockets, polluted.room);
    assertDeepEqual(pollutedResult, cleanResult, '无效提交不允许影响最终匹配结果与雷达数据');
  });
});

function lastMatchResult(
  sockets: Map<string, import('../fakes.ts').MockWebSocket>,
  room: import('../../server/roomManager.ts').Room
) {
  const socket = [...sockets.values()][0];
  const results = socket.ofType('MATCH_RESULT') as Extract<ServerMessage, { type: 'MATCH_RESULT' }>[];
  assert(results.length === 1, '应恰好收到一次 MATCH_RESULT');
  return normalizeMatchResult(results[0].payload, room);
}
