export type Species = 'cat' | 'dog' | 'rabbit' | 'other';
export type PetStatus = 'home' | 'fostering';
export type Mood = 'happy' | 'normal' | 'playful' | 'sick' | 'sleepy';

export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed: string;
  age: number;
  gender: 'male' | 'female';
  avatar: string;
  status: PetStatus;
  createdAt: string;
}

export interface Comment {
  id: string;
  username: string;
  content: string;
  createdAt: string;
}

export interface Diary {
  id: string;
  petId: string;
  petName: string;
  images: string[];
  content: string;
  mood: Mood;
  likes: number;
  liked: boolean;
  comments: Comment[];
  createdAt: string;
}

export interface DiaryListResponse {
  data: Diary[];
  hasMore: boolean;
  total: number;
  page: number;
  limit: number;
}

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export const MOOD_LABELS: Record<Mood, string> = {
  happy: '开心',
  normal: '一般',
  playful: '闹腾',
  sick: '生病',
  sleepy: '打盹'
};

export const MOOD_COLORS: Record<Mood, string> = {
  happy: '#2ECC71',
  normal: '#95A5A6',
  playful: '#E67E22',
  sick: '#E74C3C',
  sleepy: '#3498DB'
};

export const SPECIES_LABELS: Record<Species, string> = {
  cat: '猫咪',
  dog: '狗狗',
  rabbit: '兔子',
  other: '其他'
};
