export type BookStatus = 'unread' | 'reading' | 'finished';

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  totalPages: number;
}

export interface UserBook {
  id: string;
  bookId: string;
  status: BookStatus;
  progress: number;
  addedAt: number;
}

export interface Review {
  id: string;
  bookId: string;
  content: string;
  rating: number;
  likes: number;
  createdAt: number;
}

export interface CategoryGradient {
  from: string;
  to: string;
}
