export type ReadingStatus = 'want' | 'reading' | 'finished';

export interface Book {
  id: string;
  title: string;
  authors: string;
  publisher?: string;
  pageCount?: number;
  description?: string;
  imageLinks?: string;
  isbn?: string;
  status: ReadingStatus;
  rating: number;
  startDate?: string;
  endDate?: string;
  tags?: string;
  createdAt: string;
}

export interface Note {
  id: string;
  bookId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleBookVolumeInfo {
  title: string;
  authors?: string[];
  publisher?: string;
  pageCount?: number;
  description?: string;
  imageLinks?: {
    smallThumbnail?: string;
    thumbnail?: string;
    small?: string;
    medium?: string;
    large?: string;
  };
  industryIdentifiers?: Array<{
    type: string;
    identifier: string;
  }>;
  categories?: string[];
}

export interface GoogleBookItem {
  id: string;
  volumeInfo: GoogleBookVolumeInfo;
}
