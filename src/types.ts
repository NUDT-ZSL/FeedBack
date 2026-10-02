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
