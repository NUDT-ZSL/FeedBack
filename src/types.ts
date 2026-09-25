export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  publishYear: string;
  olid: string;
  progress: number;
  addedAt: string;
}

export interface Note {
  id: string;
  bookId: string;
  highlightText: string;
  thought: string;
  tags: string[];
  pageNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface InspirationCard {
  id: string;
  noteId: string;
  bookId: string;
  summary: string;
  tags: string[];
  x: number;
  y: number;
}

export interface BookSearchResult {
  title: string;
  author: string;
  coverUrl: string;
  publishYear: string;
  olid: string;
}
