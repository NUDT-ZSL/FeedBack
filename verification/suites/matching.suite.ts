import { suite, test, assert, assertEqual, assertDeepEqual } from '../harness.ts';
import {
  calculateMatches,
  generateRadarData,
  calculateMatchPercentage,
  getCommonAnswers,
  calculateUserScores,
  type AnswerRecord,
  type MatchUser
} from '../../shared/matching.ts';
import { selectRandomQuestions } from '../../shared/questions.ts';
import {
  calculateMatchPercentage as clientCalculateMatchPercentage,
  getCommonAnswers as clientGetCommonAnswers
} from '../../client/src/utils/matchCalculator.ts';
import { questions as clientQuestions } from '../../client/src/utils/questions.ts';
import { createScriptedRoom, playToCompletion, normalizeMatchResult } from '../fakes.ts';
import type { ServerMessage } from '../../shared/types.ts';

function fixedAnswers(): { users: MatchUser[]; questions: ReturnType<typeof selectRandomQuestions> } {
  const questions = selectRandomQuestions(10, 7);
  const makeAnswers = (pick: (i: number) => number, baseTime: number, step: number): AnswerRecord[] =>
    questions.map((q, i) => {
      const answer = pick(i);
      return {
        questionIndex: i,
        answer,
        correct: q.type === 'fact' ? answer === q.correctAnswer : true,
        timeSpent: baseTime + i * step
      };
    });
  const users: MatchUser[] = [
    { id: 'u-a', name: '小明', avatar: 'a0', answers: makeAnswers(i => i % 4, 2000, 137) },
    { id: 'u-b', name: '小红', avatar: 'a1', answers: makeAnswers(i => (i % 2 === 0 ? i % 4 : (i + 1) % 4), 3000, 211) },
    { id: 'u-c', name: '小刚', avatar: 'a2', answers: makeAnswers(i => (i + 1) % 4, 500, 409) },
  ];
  return { users, questions };
}

suite('类别一：匹配度/共同答案/雷达数据计算确定性与口径', () => {
  test('同一批用户与作答重复计算，匹配度与共同答案完全一致', () => {
    const { users, questions } = fixedAnswers();
    const first = calculateMatches(users, questions);
    const second = calculateMatches(users, questions);
    assertDeepEqual(second, first, '两次 calculateMatches 结果必须完全一致');
    assertEqual(JSON.stringify(second), JSON.stringify(first), '序列化结果必须一致');
  });

  test('同一批作答重复计算，雷达各项分值完全一致', () => {
    const { users, questions } = fixedAnswers();
    const first = generateRadarData(users, questions);
    const second = generateRadarData(users, questions);
    assertDeepEqual(second, first, '两次 generateRadarData 结果必须完全一致');
  });

  test('匹配度百分数与共同答案列表口径吻合', () => {
    const { users, questions } = fixedAnswers();
    const results = calculateMatches(users, questions);
    assert(results.length === 3, `3 名用户应有 3 个配对结果，实际 ${results.length}`);

    results.forEach(result => {
      const expectedPct = Math.round((result.commonAnswers.length / questions.length) * 100);
      assertEqual(result.matchPercentage, expectedPct, `用户 ${result.userName} 的匹配度口径不符`);
    });

    const expectedCommon = getCommonAnswers(users[0].answers, users[1].answers, questions);
    const pair = results.find(r => r.userId === 'u-b');
    assert(pair, '应存在 u-a 与 u-b 的配对结果');
    assertDeepEqual(pair.commonAnswers, expectedCommon, '共同答案列表与逐题比对结果不符');
  });

  test('逐题按题型独立归类的雷达分值与服务端计算一致', () => {
    const { users, questions } = fixedAnswers();
    const radar = generateRadarData(users, questions);

    users.forEach((user, userIndex) => {
      let pref = 0;
      let op = 0;
      let factAnswered = 0;
      let factCorrect = 0;
      let totalTime = 0;
      let answered = 0;

      questions.forEach((q, i) => {
        const a = user.answers.find(x => x.questionIndex === i)!;
        answered++;
        totalTime += a.timeSpent ?? 0;
        if (q.type === 'preference') pref++;
        if (q.type === 'opinion') op++;
        if (q.type === 'fact') {
          factAnswered++;
          if (a.correct) factCorrect++;
        }
      });

      const expected = [
        pref > 0 ? 100 : 0,
        op > 0 ? 100 : 0,
        factAnswered > 0 ? Math.round((factCorrect / factAnswered) * 100) : 0,
        Math.round(Math.max(0, 100 - (totalTime / answered / 15000) * 50)),
        factAnswered > 0 ? Math.round((factCorrect / factAnswered) * 100) : 0,
      ];
      assertDeepEqual(radar.users[userIndex].scores, expected, `用户 ${user.name} 雷达分值口径不符`);
      radar.users[userIndex].scores.forEach(score => {
        assert(Number.isFinite(score), `用户 ${user.name} 雷达分值不允许出现 NaN/Infinity`);
      });
    });
  });

  test('未作答任何事实题时正确率为 0 而不是 NaN', () => {
    const questions = selectRandomQuestions(10, 7);
    const answers: AnswerRecord[] = questions
      .map((q, i) => ({ questionIndex: i, answer: 0, correct: false, timeSpent: 1000 }))
      .filter((_, i) => questions[i].type !== 'fact');
    const scores = calculateUserScores(answers, questions);
    scores.forEach((score, i) => {
      assert(Number.isFinite(score), `第 ${i} 项分值必须是有限数字`);
    });
    assertEqual(scores[4], 0, '事实题未作答时正确率必须为 0');
  });

  test('客户端与服务端使用同一套匹配计算口径', () => {
    const answers1: AnswerRecord[] = [];
    const answers2: AnswerRecord[] = [];
    for (let i = 0; i < 10; i++) {
      answers1.push({ questionIndex: i, answer: i % 3, correct: true });
      answers2.push({ questionIndex: i, answer: i % 2 === 0 ? i % 3 : (i + 1) % 4, correct: true });
    }
    const clientPct = clientCalculateMatchPercentage(answers1, answers2);
    const sharedPct = calculateMatchPercentage(answers1, answers2, clientQuestions.length);
    assertEqual(clientPct, sharedPct, '客户端与共享模块的匹配度必须一致');

    const clientCommon = clientGetCommonAnswers(answers1, answers2);
    const sharedCommon = getCommonAnswers(answers1, answers2, clientQuestions);
    assertDeepEqual(clientCommon, sharedCommon, '客户端与共享模块的共同答案列表必须一致');
  });

  test('相同种子与相同作答跑完整对局，广播的最终结果可复现', () => {
    const runOnce = () => {
      const { room, scheduler, sockets } = createScriptedRoom(20260101, ['小明', '小红']);
      room.startGame();
      playToCompletion(room, scheduler, (_user, qi) => (qi % 2 === 0 ? 1 : 2));
      const socket = [...sockets.values()][0];
      const results = socket.ofType('MATCH_RESULT') as Extract<ServerMessage, { type: 'MATCH_RESULT' }>[];
      assert(results.length === 1, '对局结束应恰好广播一次 MATCH_RESULT');
      return normalizeMatchResult(results[0].payload, room);
    };
    assertDeepEqual(runOnce(), runOnce(), '两次完整对局的匹配结果必须完全一致');
  });
});
