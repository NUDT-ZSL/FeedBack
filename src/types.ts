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

export interface StoredGalleryItem extends GalleryItem {
  round: number;
  patternKey: string;
  updatedAt: number;
  conflictKey: string | null;
}

export interface MatchRecord {
  id: string;
  round: number;
  userScore: Score;
  aiScore: Score;
  winner: 'user' | 'ai' | 'draw';
  recordedAt: number;
  conflictKey: string | null;
}

export interface MatchStats {
  wins: number;
  losses: number;
  draws: number;
  total: number;
}

export interface PersistedStateV1 {
  version: 1;
  gallery: StoredGalleryItem[];
  records: MatchRecord[];
}
