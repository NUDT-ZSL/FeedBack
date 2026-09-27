export interface Question {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface PlayerScore {
  nickname: string;
  avatar: number;
  score: number;
  timeInSeconds: number;
}

export interface UserProfile {
  nickname: string;
  avatar: number;
}

export type Page = 'welcome' | 'quiz' | 'leaderboard';
