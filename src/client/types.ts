export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface Annotation {
  id: string;
  bookId: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  color?: string;
  note?: string;
  createdAt: number;
}

export interface ShareLink {
  id: string;
  bookId: string;
  annotations: Annotation[];
  targetEmail: string;
  createdAt: number;
}
