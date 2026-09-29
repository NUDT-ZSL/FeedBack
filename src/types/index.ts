export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition';

export type SpeechSpeed = 'slow' | 'normal' | 'fast';

export type SortOrder = 'asc' | 'desc';

export interface Word {
  id: string;
  english: string;
  chinese: string;
  partOfSpeech: PartOfSpeech;
  mastery: number;
  wrongCount: number;
  lastAttemptAt: number;
  createdAt: number;
}

export interface QuizConfig {
  selectedParts: PartOfSpeech[];
  questionCount: number;
  speed: SpeechSpeed;
}

export interface QuizAnswer {
  wordId: string;
  english: string;
  userInput: string;
  correct: boolean;
}

export interface QuizResult {
  totalQuestions: number;
  correctCount: number;
  accuracy: number;
  durationMs: number;
  answers: QuizAnswer[];
  wrongWords: Word[];
}

export type FeedbackState = 'idle' | 'correct' | 'wrong';

export interface FeedbackInfo {
  state: FeedbackState;
  correctSpelling?: string;
}

export const PART_OF_SPEECH_LABELS: Record<PartOfSpeech, string> = {
  noun: '名词',
  verb: '动词',
  adjective: '形容词',
  adverb: '副词',
  preposition: '介词',
};

export const PART_OF_SPEECH_COLORS: Record<PartOfSpeech, string> = {
  noun: '#4A90D9',
  verb: '#50B86C',
  adjective: '#F5A623',
  adverb: '#9B59B6',
  preposition: '#E74C3C',
};

export const SPEECH_SPEED_VALUES: Record<SpeechSpeed, number> = {
  slow: 0.6,
  normal: 0.9,
  fast: 1.2,
};

export const SPEECH_SPEED_LABELS: Record<SpeechSpeed, string> = {
  slow: '慢速',
  normal: '正常',
  fast: '快速',
};
