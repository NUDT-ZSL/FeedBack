import type { Question } from '../../../shared/types';
import { allQuestions } from '../../../shared/questions';

export const questions: Question[] = allQuestions;

export const preferenceQuestions = questions.filter(q => q.type === 'preference');
export const opinionQuestions = questions.filter(q => q.type === 'opinion');
export const factQuestions = questions.filter(q => q.type === 'fact');
