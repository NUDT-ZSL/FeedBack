export interface TeaPattern {
  id: string;
  type: 'pine_crane' | 'butterflies' | 'landscape' | 'orchid_bamboo';
  name: string;
  poem: string;
  paths: Array<{ points: number[][]; strokeWidth: number }>;
}

export interface GalleryItem {
  id: string;
  pattern: TeaPattern;
  thumbnail: string;
  createdAt: number;
  round: number;
  roundScore: {
    color: number;
    duration: number;
    adhesion: number;
    total: number;
  };
}

export interface Score {
  color: number;
  duration: number;
  adhesion: number;
  total: number;
}

export type GamePhase = 
  | 'idle' 
  | 'pouring' 
  | 'whisking' 
  | 'user_done' 
  | 'ai_playing' 
  | 'scoring' 
  | 'pattern_showing';

export interface AIPerformance {
  waterAmount: number;
  whiskSpeed: number;
  whiskDuration: number;
  delay: number;
}

export interface RoundRecord {
  id: string;
  round: number;
  userScore: Score;
  aiScore: Score;
  updatedAt: number;
}

export interface ResolvedRound extends RoundRecord {
  winner: 'user' | 'ai' | 'draw';
}

export interface RoundConflict {
  round: number;
  candidates: RoundRecord[];
}

export interface MatchHistory {
  rounds: ResolvedRound[];
  conflicts: RoundConflict[];
  totals: { wins: number; losses: number; draws: number };
}
