export interface Story {
  id: string;
  title: string;
  author: string;
  coverEmoji: string;
  description: string;
  publishedAt: string;
  chapters: Chapter[];
  averageRating: number;
  ratingCount: number;
}

export interface Chapter {
  id: string;
  title: string;
  content: string[];
  averageRating: number;
  ratingCount: number;
}

export interface Annotation {
  id: string;
  storyId: string;
  chapterId: string;
  paragraphIndex: number;
  content: string;
  createdAt: string;
}

export interface Rating {
  id: string;
  storyId: string;
  chapterId: string;
  score: number;
  review?: string;
  createdAt: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export type SortOrder = 'newest' | 'oldest';
