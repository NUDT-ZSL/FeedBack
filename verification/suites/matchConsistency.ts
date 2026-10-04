import type { Question, User } from '../../shared/types';
import { selectQuestions } from '../../shared/questions';
import { calculateMatches, generateRadarData, RADAR_CATEGORIES } from '../../shared/match';
import { calculateMatchPercentage, getCommonAnswers } from '../../client/src/utils/matchCalculator';
import { createTestRoom, Suite } from '../harness';

function buildUsers(): User[] {
  const makeAnswers = (picker: (idx: number) => number | null) =>
    Array.from({ length: 10 }, (_, idx) => picker(idx))
      .map((answer, idx) =>
        answer === null
          ? null
          : { questionIndex: idx, answer, correct: answer === 2, timeSpent: 1000 * (idx + 1) }
      )
      .filter((answer): answer is NonNullable<typeof answer> => answer !== null);

  return [
    { id: 'u1', name: '甲', avatar: 'a1', roomId: 'R', answers: makeAnswers(idx => idx % 4) },
    { id: 'u2', name: '乙', avatar: 'a2', roomId: 'R', answers: makeAnswers(idx => (idx % 2 === 0 ? idx % 4 : (idx + 1) % 4)) },
    { id: 'u3', name: '丙', avatar: 'a3', roomId: 'R', answers: makeAnswers(idx => (idx < 6 ? 2 : null)) },
  ];
}

function expectedScoresByType(user: User, questions: Question[]): number[] {
  const byType = { preference: 0, opinion: 0, fact: 0 };
  const answered = { preference: 0, opinion: 0, fact: 0 };
  let totalTime = 0;
  let answeredCount = 0;
  let correctCount = 0;

  questions.forEach((question, idx) => {
    const answer = user.answers.find(a => a.questionIndex === idx);
    if (!answer || answer.answer === -1) return;
    answeredCount++;
    totalTime += answer.timeSpent;
    answered[question.type]++;
    if (question.type === 'preference') byType.preference += 100;
    if (question.type === 'opinion') byType.opinion += 100;
    if (question.type === 'fact' && answer.correct) {
      byType.fact += 100;
      correctCount++;
    }
  });

  return [
    answered.preference > 0 ? Math.round(byType.preference / answered.preference) : 0,
    answered.opinion > 0 ? Math.round(byType.opinion / answered.opinion) : 0,
    answered.fact > 0 ? Math.round(byType.fact / answered.fact) : 0,
    answeredCount > 0 ? Math.round(Math.max(0, 100 - (totalTime / answeredCount / 15000) * 50)) : 0,
    answeredCount > 0 ? Math.round((correctCount / answered.fact) * 100) : 0,
  ];
}

export function matchConsistencySuite(suite: Suite): void {
  const questions = selectQuestions(10, 7);
  const users = buildUsers();

  const firstMatches = calculateMatches(users, questions);
  const firstRadar = generateRadarData(users, questions);

  for (let round = 2; round <= 3; round++) {
    suite.assertEqual(`第 ${round} 次重复计算匹配结果完全一致`, calculateMatches(users, questions), firstMatches);
    suite.assertEqual(`第 ${round} 次重复计算雷达数据完全一致`, generateRadarData(users, questions), firstRadar);
  }

  suite.assertEqual('雷达分类维度固定为五类', firstRadar.categories, [...RADAR_CATEGORIES]);

  const pairCount = (users.length * (users.length - 1)) / 2;
  suite.assertEqual('匹配结果覆盖全部用户对', firstMatches.length, pairCount);

  let percentageOk = true;
  let commonContentOk = true;
  for (const result of firstMatches) {
    if (result.matchPercentage !== Math.round((result.commonAnswers.length / questions.length) * 100)) {
      percentageOk = false;
    }
    for (const common of result.commonAnswers) {
      const question = questions[common.questionIndex];
      if (
        common.questionText !== question.text ||
        common.optionText !== question.options[common.answer]
      ) {
        commonContentOk = false;
      }
    }
  }
  suite.check('匹配度与共同答案数量口径吻合', percentageOk);
  suite.check('共同答案的题目与选项文本和题库一致', commonContentOk);

  let radarOk = true;
  for (const radarUser of firstRadar.users) {
    const user = users.find(u => u.id === radarUser.userId)!;
    const expected = expectedScoresByType(user, questions);
    if (JSON.stringify(radarUser.scores) !== JSON.stringify(expected)) {
      radarOk = false;
    }
  }
  suite.check('雷达各项分值与逐题按题型归类的口径吻合', radarOk);

  const { room } = createTestRoom({ userCount: 0 });
  room.questions = questions;
  room.users = users.map(u => ({ ...u, answers: u.answers.map(a => ({ ...a })) }));
  suite.assertEqual('房间内存对象计算结果与共享纯函数一致（匹配）', room.calculateMatches(), firstMatches);
  suite.assertEqual('房间内存对象计算结果与共享纯函数一致（雷达）', room.generateRadarData(), firstRadar);

  const clientPercentage = calculateMatchPercentage(users[0].answers, users[1].answers, questions);
  suite.assertEqual(
    '客户端与服务端匹配度口径一致',
    clientPercentage,
    firstMatches.find(m => m.userId === 'u2')!.matchPercentage
  );
  suite.assertEqual(
    '客户端与服务端共同答案口径一致',
    getCommonAnswers(users[0].answers, users[1].answers, questions),
    firstMatches.find(m => m.userId === 'u2')!.commonAnswers
  );
}
