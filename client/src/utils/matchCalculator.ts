import type { Question, User } from '../../../shared/types';
import { calculateMatches } from '../../../shared/match';
import { questions } from './questions';

interface Answer {
  questionIndex: number;
  answer: number;
  correct: boolean;
  timeSpent?: number;
}

function toUser(id: string, answers: Answer[]): User {
  return {
    id,
    name: id,
    avatar: '',
    roomId: '',
    answers: answers.map(a => ({ ...a, timeSpent: a.timeSpent ?? 0 })),
  };
}

export function calculateMatchPercentage(
  user1Answers: Answer[],
  user2Answers: Answer[],
  questionList: Question[] = questions
): number {
  if (user1Answers.length === 0 || user2Answers.length === 0) {
    return 0;
  }

  const results = calculateMatches(
    [toUser('user1', user1Answers), toUser('user2', user2Answers)],
    questionList
  );
  return results[0]?.matchPercentage ?? 0;
}

export function calculateMatchBetweenUsers(user1: User, user2: User, questionList: Question[] = questions): number {
  return calculateMatchPercentage(user1.answers, user2.answers, questionList);
}

export function getCommonAnswers(
  user1Answers: Answer[],
  user2Answers: Answer[],
  questionList: Question[] = questions
): { questionIndex: number; answer: number; questionText: string; optionText: string }[] {
  const results = calculateMatches(
    [toUser('user1', user1Answers), toUser('user2', user2Answers)],
    questionList
  );
  return results[0]?.commonAnswers ?? [];
}
