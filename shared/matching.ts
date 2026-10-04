import type { MatchResult, Question, RadarData } from './types.ts';

export interface AnswerRecord {
  questionIndex: number;
  answer: number;
  correct: boolean;
  timeSpent?: number;
}

export interface MatchUser {
  id: string;
  name: string;
  avatar: string;
  answers: AnswerRecord[];
}

export const QUESTION_TIME_MS = 15000;

export const MATCH_CATEGORIES = ['生活偏好', '观点态度', '知识掌握', '答题速度', '正确率'];

export const USER_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

export function calculateMatchPercentage(
  user1Answers: AnswerRecord[],
  user2Answers: AnswerRecord[],
  totalQuestions: number
): number {
  if (totalQuestions <= 0) return 0;

  let sameAnswerCount = 0;
  for (let i = 0; i < totalQuestions; i++) {
    const answer1 = user1Answers.find(a => a.questionIndex === i);
    const answer2 = user2Answers.find(a => a.questionIndex === i);
    if (answer1 && answer2 && answer1.answer === answer2.answer && answer1.answer !== -1) {
      sameAnswerCount++;
    }
  }

  return Math.round((sameAnswerCount / totalQuestions) * 100);
}

export function getCommonAnswers(
  user1Answers: AnswerRecord[],
  user2Answers: AnswerRecord[],
  questions: Question[]
): MatchResult['commonAnswers'] {
  const common: MatchResult['commonAnswers'] = [];

  questions.forEach((question, idx) => {
    const answer1 = user1Answers.find(a => a.questionIndex === idx);
    const answer2 = user2Answers.find(a => a.questionIndex === idx);

    if (answer1 && answer2 && answer1.answer === answer2.answer && answer1.answer !== -1) {
      common.push({
        questionIndex: idx,
        answer: answer1.answer,
        questionText: question.text,
        optionText: question.options[answer1.answer],
      });
    }
  });

  return common;
}

export function calculateMatches(users: MatchUser[], questions: Question[]): MatchResult[] {
  if (users.length < 2) return [];

  const results: MatchResult[] = [];

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const user1 = users[i];
      const user2 = users[j];

      results.push({
        userId: user2.id,
        userName: user2.name,
        userAvatar: user2.avatar,
        matchPercentage: calculateMatchPercentage(user1.answers, user2.answers, questions.length),
        commonAnswers: getCommonAnswers(user1.answers, user2.answers, questions),
      });
    }
  }

  return results.sort((a, b) => b.matchPercentage - a.matchPercentage);
}

export function calculateUserScores(
  answers: AnswerRecord[],
  questions: Question[],
  questionTimeMs: number = QUESTION_TIME_MS
): number[] {
  let preferenceCount = 0;
  let opinionCount = 0;
  let factCount = 0;
  let totalTime = 0;
  let correctCount = 0;
  let answeredCount = 0;

  questions.forEach((question, idx) => {
    const answer = answers.find(a => a.questionIndex === idx);
    if (!answer || answer.answer === -1) return;

    answeredCount++;
    totalTime += answer.timeSpent ?? 0;

    if (question.type === 'preference') {
      preferenceCount++;
    } else if (question.type === 'opinion') {
      opinionCount++;
    } else if (question.type === 'fact') {
      factCount++;
      if (answer.correct) {
        correctCount++;
      }
    }
  });

  const preferenceScore = preferenceCount > 0 ? 100 : 0;
  const opinionScore = opinionCount > 0 ? 100 : 0;
  const factScore = factCount > 0 ? (correctCount / factCount) * 100 : 0;
  const speedScore = answeredCount > 0 ? Math.max(0, 100 - (totalTime / answeredCount / questionTimeMs) * 50) : 0;
  const accuracyScore = factCount > 0 ? (correctCount / factCount) * 100 : 0;

  return [
    Math.round(preferenceScore),
    Math.round(opinionScore),
    Math.round(factScore),
    Math.round(speedScore),
    Math.round(accuracyScore),
  ];
}

export function generateRadarData(
  users: MatchUser[],
  questions: Question[],
  colors: string[] = USER_COLORS
): RadarData {
  const radarUsers = users.map((user, idx) => ({
    userId: user.id,
    userName: user.name,
    color: colors[idx % colors.length],
    scores: calculateUserScores(user.answers, questions),
  }));

  return {
    categories: [...MATCH_CATEGORIES],
    selfScores: radarUsers[0]?.scores ?? [0, 0, 0, 0, 0],
    users: radarUsers,
  };
}
