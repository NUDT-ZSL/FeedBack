import type { Book, ReadingStatus } from '../types';

export const MIN_RATING = 0;
export const MAX_RATING = 5;

export function toISODate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function applyStatusTransition(
  book: Book,
  next: ReadingStatus,
  today: string = toISODate(),
): Book {
  switch (next) {
    case 'want':
      return { ...book, status: 'want', rating: 0, startDate: undefined, endDate: undefined };
    case 'reading':
      return { ...book, status: 'reading', startDate: book.startDate ?? today, endDate: undefined };
    case 'finished':
      return { ...book, status: 'finished', startDate: book.startDate ?? today, endDate: today };
  }
}

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

export function isValidBookState(book: Book): boolean {
  if (!isValidRating(book.rating)) return false;
  switch (book.status) {
    case 'want':
      return book.rating === 0 && !book.startDate && !book.endDate;
    case 'reading':
      return Boolean(book.startDate) && !book.endDate;
    case 'finished':
      return Boolean(book.endDate);
    default:
      return false;
  }
}
