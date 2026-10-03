import type { Book, ReadingStatus } from '../types';

export interface BookStateViolation {
  field: string;
  message: string;
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function transitionBookStatus(
  book: Book,
  next: ReadingStatus,
  today: string = todayISO(),
): Book {
  switch (next) {
    case 'want':
      return { ...book, status: 'want', rating: 0, startDate: undefined, endDate: undefined };
    case 'reading':
      return { ...book, status: 'reading', startDate: book.startDate ?? today, endDate: undefined };
    case 'finished': {
      const startDate = book.startDate ?? today;
      let endDate = book.endDate ?? today;
      if (endDate < startDate) {
        endDate = startDate;
      }
      return { ...book, status: 'finished', startDate, endDate };
    }
  }
}

export function validateBookState(book: Book): BookStateViolation[] {
  const violations: BookStateViolation[] = [];

  if (!Number.isInteger(book.rating) || book.rating < 0 || book.rating > 5) {
    violations.push({ field: 'rating', message: `评分必须是 0-5 的整数，当前为 ${book.rating}` });
  }

  if (book.status === 'want') {
    if (book.rating !== 0) {
      violations.push({ field: 'rating', message: '想读状态不允许评分' });
    }
    if (book.startDate) {
      violations.push({ field: 'startDate', message: '想读状态不允许开始日期' });
    }
    if (book.endDate) {
      violations.push({ field: 'endDate', message: '想读状态不允许结束日期' });
    }
  }

  if (book.status === 'reading') {
    if (!book.startDate) {
      violations.push({ field: 'startDate', message: '在读状态必须记录开始日期' });
    }
    if (book.endDate) {
      violations.push({ field: 'endDate', message: '在读状态不允许结束日期' });
    }
  }

  if (book.status === 'finished') {
    if (!book.startDate) {
      violations.push({ field: 'startDate', message: '读完状态必须记录开始日期' });
    }
    if (!book.endDate) {
      violations.push({ field: 'endDate', message: '读完状态必须记录结束日期' });
    }
    if (book.startDate && book.endDate && book.endDate < book.startDate) {
      violations.push({ field: 'endDate', message: '结束日期不能早于开始日期' });
    }
  }

  return violations;
}

export function isValidBookState(book: Book): boolean {
  return validateBookState(book).length === 0;
}
