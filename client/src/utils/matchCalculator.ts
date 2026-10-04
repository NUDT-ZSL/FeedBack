import type { User } from '../../../shared/types';
import {
  calculateMatchPercentage as sharedCalculateMatchPercentage,
  getCommonAnswers as sharedGetCommonAnswers,
  type AnswerRecord
} from '../../../shared/matching.ts';
import { questions } from './questions.ts';

export type Answer = AnswerRecord;

export function calculateMatchPercentage(user1Answers: Answer[], user2Answers: Answer[]): number {
  if (user1Answers.length === 0 || user2Answers.length === 0) {
    return 0;
  }
  return sharedCalculateMatchPercentage(user1Answers, user2Answers, questions.length);
}

export function calculateMatchBetweenUsers(user1: User, user2: User): number {
  return calculateMatchPercentage(user1.answers, user2.answers);
}

export function getCommonAnswers(
  user1Answers: Answer[],
  user2Answers: Answer[]
): { questionIndex: number; answer: number; questionText: string; optionText: string }[] {
  return sharedGetCommonAnswers(user1Answers, user2Answers, questions);
}
