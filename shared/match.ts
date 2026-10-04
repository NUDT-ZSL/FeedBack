import type { User, Question, MatchResult, RadarData } from './types';

export const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

export const RADAR_CATEGORIES = ['生活偏好', '观点态度', '知识掌握', '答题速度', '正确率'];

export function calculateMatches(users: User[], questions: Question[]): MatchResult[] {
  if (users.length < 2) return [];

  const results: MatchResult[] = [];

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const user1 = users[i];
      const user2 = users[j];

      let commonCount = 0;
      const commonAnswers: MatchResult['commonAnswers'] = [];

      questions.forEach((question, idx) => {
        const ans1 = user1.answers.find(a => a.questionIndex === idx);
        const ans2 = user2.answers.find(a => a.questionIndex === idx);

        if (ans1 && ans2 && ans1.answer === ans2.answer && ans1.answer !== -1) {
          commonCount++;
          commonAnswers.push({
            questionIndex: idx,
            answer: ans1.answer,
            questionText: question.text,
            optionText: question.options[ans1.answer],
          });
        }
      });

      const matchPercentage = Math.round((commonCount / questions.length) * 100);

      results.push({
        userId: user2.id,
        userName: user2.name,
        userAvatar: user2.avatar,
        matchPercentage,
        commonAnswers,
      });
    }
  }

  return results.sort((a, b) => b.matchPercentage - a.matchPercentage);
}

export function calculateUserScores(user: User, questions: Question[]): number[] {
  let preferenceScore = 0;
  let opinionScore = 0;
  let factScore = 0;
  let preferenceCount = 0;
  let opinionCount = 0;
  let factCount = 0;
  let totalTime = 0;
  let correctCount = 0;
  let answeredCount = 0;

  questions.forEach((question, idx) => {
    const answer = user.answers.find(a => a.questionIndex === idx);
    if (!answer || answer.answer === -1) return;

    answeredCount++;
    totalTime += answer.timeSpent;

    if (question.type === 'preference') {
      preferenceCount++;
      preferenceScore += 100;
    } else if (question.type === 'opinion') {
      opinionCount++;
      opinionScore += 100;
    } else if (question.type === 'fact') {
      factCount++;
      if (answer.correct) {
        correctCount++;
        factScore += 100;
      }
    }
  });

  const avgPreference = preferenceCount > 0 ? preferenceScore / preferenceCount : 0;
  const avgOpinion = opinionCount > 0 ? opinionScore / opinionCount : 0;
  const avgFact = factCount > 0 ? factScore / factCount : 0;
  const speedScore = answeredCount > 0 ? Math.max(0, 100 - (totalTime / answeredCount / 15000) * 50) : 0;
  const accuracyScore = answeredCount > 0 ? (correctCount / factCount) * 100 : 0;

  return [
    Math.round(avgPreference),
    Math.round(avgOpinion),
    Math.round(avgFact),
    Math.round(speedScore),
    Math.round(accuracyScore),
  ];
}

export function generateRadarData(users: User[], questions: Question[]): RadarData {
  const radarUsers = users.map((user, idx) => {
    const scores = calculateUserScores(user, questions);
    return {
      userId: user.id,
      userName: user.name,
      color: USER_COLORS[idx % USER_COLORS.length],
      scores,
    };
  });

  return {
    categories: [...RADAR_CATEGORIES],
    selfScores: radarUsers[0]?.scores ?? [0, 0, 0, 0, 0],
    users: radarUsers,
  };
}
