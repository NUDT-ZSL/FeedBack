export interface BorrowRecord {
  name: string;
  phone: string;
  returnDate: string;
  borrowDate: string;
}

export type BookCategory = '文学' | '历史' | '哲学' | '科学' | '艺术';

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  category: BookCategory;
  stock: number;
  totalStock: number;
  description: string;
  borrowRecords: BorrowRecord[];
}
