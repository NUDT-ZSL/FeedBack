export type MoodType = 'happy' | 'calm' | 'anxious' | 'tired' | 'angry';

export interface MoodRecord {
  id: string;
  mood: MoodType;
  timestamp: number;
  date: string;
}

export interface MoodStats {
  date: string;
  total: number;
  distribution: Record<MoodType, number>;
  percentages: Record<MoodType, number>;
}

export interface ThresholdConfig {
  mood: MoodType;
  threshold: number;
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  mood: MoodType;
  percentage: number;
  threshold: number;
  timestamp: number;
  date: string;
}

export interface MoodConfig {
  type: MoodType;
  label: string;
  emoji: string;
  color: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
