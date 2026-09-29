import { create } from 'zustand';
import type { Book, UserBook, Review, BookStatus } from '../types';
import { books } from '../data/books';
import { mockReviews } from '../data/mockReviews';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const clampProgress = (progress: number) => Math.max(0, Math.min(100, Math.round(progress)));

function compareByCreatedAtDesc(a: Review, b: Review) {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return b.id.localeCompare(a.id);
}

function compareTopReviews(a: Review, b: Review) {
  if (b.likes !== a.likes) return b.likes - a.likes;
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return b.id.localeCompare(a.id);
}

const likedReviewIds = new Set<string>();
const progressBeforeFinished = new Map<string, number>();

interface ReviewCache<T> {
  reviews: Review[] | null;
  value: T;
}

interface TopReviewsCache extends ReviewCache<Review[]> {
  cutoff: number;
}

const reviewsByBookCache = new Map<string, ReviewCache<Review[]>>();
const topReviewsCache: TopReviewsCache = {
  reviews: null,
  value: [],
  cutoff: Date.now() - SEVEN_DAYS_MS,
};

function invalidateReviewCaches() {
  reviewsByBookCache.clear();
  topReviewsCache.reviews = null;
}

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
  isReviewLiked: (reviewId: string) => boolean;
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
        ub.id !== userBookId || ub.status === status
          ? ub
          : (() => {
              if (status === 'finished') {
                progressBeforeFinished.set(
                  userBookId,
                  ub.status === 'reading' ? ub.progress : 0
                );
                return { ...ub, status, progress: 100 };
              }

              if (status === 'reading') {
                const previousProgress = progressBeforeFinished.get(userBookId);
                progressBeforeFinished.delete(userBookId);
                return {
                  ...ub,
                  status,
                  progress:
                    ub.status === 'finished'
                      ? Math.min(previousProgress ?? 99, 99)
                      : Math.max(ub.progress, 0),
                };
              }

              progressBeforeFinished.delete(userBookId);
              return { ...ub, status, progress: 0 };
            })()
      ),
    }));
  },

  updateBookProgress: (userBookId: string, progress: number) => {
    const nextProgress = clampProgress(progress);

    set(state => ({
      userBooks: state.userBooks.map(ub =>
        ub.id !== userBookId
          ? ub
          : (() => {
              if (ub.status === 'finished') {
                if (nextProgress < 100) {
                  progressBeforeFinished.delete(userBookId);
                  return { ...ub, status: 'reading', progress: nextProgress };
                }
                return ub;
              }

              if (ub.status === 'unread' && nextProgress > 0) {
                return { ...ub, status: 'reading', progress: nextProgress };
              }

              if (ub.status === 'reading' && nextProgress === 100) {
                progressBeforeFinished.set(userBookId, 100);
                return { ...ub, status: 'finished', progress: 100 };
              }

              if (ub.status === 'reading') {
                progressBeforeFinished.delete(userBookId);
              }

              return { ...ub, progress: nextProgress };
            })()
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
    invalidateReviewCaches();
  },

  likeReview: (reviewId: string) => {
    if (likedReviewIds.has(reviewId)) return;
    likedReviewIds.add(reviewId);

    set(state => ({
      reviews: state.reviews.map(r =>
        r.id === reviewId ? { ...r, likes: r.likes + 1 } : r
      ),
    }));
    invalidateReviewCaches();
  },

  isReviewLiked: (reviewId: string) => {
    return likedReviewIds.has(reviewId);
  },

  getBookById: (bookId: string) => {
    return get().allBooks.find(b => b.id === bookId);
  },

  getReviewsByBookId: (bookId: string) => {
    const reviews = get().reviews;
    const cached = reviewsByBookCache.get(bookId);
    if (cached?.reviews === reviews) return cached.value;

    const value = reviews
      .filter(r => r.bookId === bookId)
      .sort(compareByCreatedAtDesc);
    reviewsByBookCache.set(bookId, { reviews, value });
    return value;
  },

  getTopReviews: () => {
    const reviews = get().reviews;
    if (topReviewsCache.reviews === reviews) return topReviewsCache.value;

    const value = reviews
      .filter(r => r.createdAt >= topReviewsCache.cutoff)
      .sort(compareTopReviews)
      .slice(0, 10);
    topReviewsCache.reviews = reviews;
    topReviewsCache.value = value;
    return value;
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
