import type { User } from '../../../shared/types';
import { questions } from './questions';

interface Answer {
  questionIndex: number;
  answer: number;
  correct: boolean;
}

export function calculateMatchPercentage(user1Answers: Answer[], user2Answers: Answer[]): number {
  if (user1Answers.length === 0 || user2Answers.length === 0) {
    return 0;
  }

  const totalQuestions = questions.length;
  let sameAnswerCount = 0;

  for (let i = 0; i < totalQuestions; i++) {
    const answer1 = user1Answers.find(a => a.questionIndex === i);
    const answer2 = user2Answers.find(a => a.questionIndex === i);

    if (answer1 && answer2 && answer1.answer === answer2.answer) {
      sameAnswerCount++;
    }
  }

  return Math.round((sameAnswerCount / totalQuestions) * 100);
}

export function calculateMatchBetweenUsers(user1: User, user2: User): number {
  return calculateMatchPercentage(user1.answers, user2.answers);
}

export function getCommonAnswers(
  user1Answers: Answer[],
  user2Answers: Answer[]
): { questionIndex: number; answer: number; questionText: string; optionText: string }[] {
  const common: { questionIndex: number; answer: number; questionText: string; optionText: string }[] = [];

  for (let i = 0; i < questions.length; i++) {
    const answer1 = user1Answers.find(a => a.questionIndex === i);
    const answer2 = user2Answers.find(a => a.questionIndex === i);

    if (answer1 && answer2 && answer1.answer === answer2.answer) {
      const question = questions[i];
      common.push({
        questionIndex: i,
        answer: answer1.answer,
        questionText: question.text,
        optionText: question.options[answer1.answer],
      });
    }
  }

  return common;
}
