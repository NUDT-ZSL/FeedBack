import { create } from 'zustand';
import type { Book, UserBook, Review, BookStatus } from '../types';
import { books } from '../data/books';
import { mockReviews } from '../data/mockReviews';

interface BookStore {
  allBooks: Book[];
  userBooks: UserBook[];
  reviews: Review[];
  searchKeyword: string;
  currentPage: 'shelf' | 'community';
  pageTransition: boolean;

  searchBooks: (keyword: string) => Book[];
  addToShelf: (bookId: string) => void;
  updateBookStatus: (userBookId: string, status: BookStatus) => void;
  updateBookProgress: (userBookId: string, progress: number) => void;
  addReview: (bookId: string, content: string, rating: number) => void;
  likeReview: (reviewId: string) => void;
  getBookById: (bookId: string) => Book | undefined;
  getReviewsByBookId: (bookId: string) => Review[];
  getTopReviews: () => Review[];
  setCurrentPage: (page: 'shelf' | 'community') => void;
  setSearchKeyword: (keyword: string) => void;
}

function initializeUserBooks(): UserBook[] {
  const initialUserBooks: UserBook[] = [];
  const statuses: BookStatus[] = ['unread', 'reading', 'finished'];
  
  for (let i = 0; i < 30; i++) {
    const status = statuses[i % 3];
    initialUserBooks.push({
      id: `user-book-${i + 1}`,
      bookId: `book-${i + 1}`,
      status,
      progress: status === 'unread' ? 0 : status === 'reading' ? Math.floor(Math.random() * 80) + 10 : 100,
      addedAt: Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000),
    });
  }
  
  return initialUserBooks;
}

export const useBookStore = create<BookStore>((set, get) => ({
  allBooks: books,
  userBooks: initializeUserBooks(),
  reviews: mockReviews,
  searchKeyword: '',
  currentPage: 'shelf',
  pageTransition: false,

  searchBooks: (keyword: string) => {
    if (!keyword.trim()) return [];
    const lowerKeyword = keyword.toLowerCase();
    return get().allBooks.filter(
      book =>
        book.title.toLowerCase().includes(lowerKeyword) ||
        book.author.toLowerCase().includes(lowerKeyword)
    );
  },

  addToShelf: (bookId: string) => {
    const existing = get().userBooks.find(ub => ub.bookId === bookId);
    if (existing) return;
    
    set(state => ({
      userBooks: [
        ...state.userBooks,
        {
          id: `user-book-${Date.now()}`,
          bookId,
          status: 'unread',
          progress: 0,
          addedAt: Date.now(),
        },
      ],
    }));
  },

  updateBookStatus: (userBookId: string, status: BookStatus) => {
    set(state => ({
      userBooks: state.userBooks.map(ub =>
        ub.id === userBookId
          ? { ...ub, status, progress: status === 'finished' ? 100 : ub.progress }
          : ub
      ),
    }));
  },

  updateBookProgress: (userBookId: string, progress: number) => {
    set(state => ({
      userBooks: state.userBooks.map(ub =>
        ub.id === userBookId ? { ...ub, progress: Math.max(0, Math.min(100, progress)) } : ub
      ),
    }));
  },

  addReview: (bookId: string, content: string, rating: number) => {
    set(state => ({
      reviews: [
        {
          id: `review-${Date.now()}`,
          bookId,
          content,
          rating,
          likes: 0,
          createdAt: Date.now(),
        },
        ...state.reviews,
      ],
    }));
  },

  likeReview: (reviewId: string) => {
    set(state => ({
      reviews: state.reviews.map(r =>
        r.id === reviewId ? { ...r, likes: r.likes + 1 } : r
      ),
    }));
  },

  getBookById: (bookId: string) => {
    return get().allBooks.find(b => b.id === bookId);
  },

  getReviewsByBookId: (bookId: string) => {
    return get().reviews.filter(r => r.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt);
  },

  getTopReviews: () => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return get().reviews
      .filter(r => r.createdAt >= sevenDaysAgo)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 10);
  },

  setCurrentPage: (page: 'shelf' | 'community') => {
    set({ pageTransition: true });
    setTimeout(() => {
      set({ currentPage: page, pageTransition: false });
    }, 300);
  },

  setSearchKeyword: (keyword: string) => {
    set({ searchKeyword: keyword });
  },
}));
