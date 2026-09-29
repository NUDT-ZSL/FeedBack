import { create } from 'zustand';
import type { Book, UserBook, Review, BookStatus } from '../types';
import { books } from '../data/books';
import { mockReviews } from '../data/mockReviews';

interface BookStore {
  allBooks: Book[];
  userBooks: UserBook[];
  reviews: Review[];
  likedReviewIds: string[];
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 进度与状态的联动规则统一收敛在 store 内部：
// finished 必然 progress=100，unread 必然 progress=0，
// reading 的进度必须落在 0-99，避免“已读 100% 切回在读”后自相矛盾。
function applyStatus(userBook: UserBook, status: BookStatus): UserBook {
  if (status === 'finished') return { ...userBook, status, progress: 100 };
  if (status === 'unread') return { ...userBook, status, progress: 0 };
  const progress = userBook.progress >= 100 ? 99 : userBook.progress;
  return { ...userBook, status, progress };
}

// 修改进度时同步修正状态：写满 100 即读完；已读书被改回 100 以下则回到在读。
function applyProgress(userBook: UserBook, progress: number): UserBook {
  const clamped = Math.max(0, Math.min(100, progress));
  if (clamped === 100) return { ...userBook, status: 'finished', progress: 100 };
  if (userBook.status === 'finished') {
    return { ...userBook, status: 'reading', progress: clamped };
  }
  return { ...userBook, progress: clamped };
}

// 派生结果缓存：以 reviews 数组引用作为版本号，
// 同一批数据（同一渲染周期）内重复读取直接命中缓存，返回同一引用。
let derivedVersion: Review[] | null = null;
let reviewsByBookCache: Map<string, Review[]> = new Map();
let topReviewsCache: Review[] | null = null;

function ensureDerivedCaches(reviews: Review[]): void {
  if (derivedVersion !== reviews) {
    derivedVersion = reviews;
    reviewsByBookCache = new Map();
    topReviewsCache = null;
  }
}

function getCachedReviewsByBook(reviews: Review[], bookId: string): Review[] {
  ensureDerivedCaches(reviews);
  let list = reviewsByBookCache.get(bookId);
  if (!list) {
    list = reviews
      .filter(r => r.bookId === bookId)
      .sort((a, b) => b.createdAt - a.createdAt || compareIds(a.id, b.id));
    reviewsByBookCache.set(bookId, list);
  }
  return list;
}

function getCachedTopReviews(reviews: Review[]): Review[] {
  ensureDerivedCaches(reviews);
  if (!topReviewsCache) {
    const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
    topReviewsCache = reviews
      .filter(r => r.createdAt >= sevenDaysAgo)
      // 稳定排序：点赞数降序；并列时按时间降序、再按 id 升序，名次不跳变
      .sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt || compareIds(a.id, b.id))
      .slice(0, 10);
  }
  return topReviewsCache;
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
  likedReviewIds: [],
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
        ub.id === userBookId ? applyStatus(ub, status) : ub
      ),
    }));
  },

  updateBookProgress: (userBookId: string, progress: number) => {
    set(state => ({
      userBooks: state.userBooks.map(ub =>
        ub.id === userBookId ? applyProgress(ub, progress) : ub
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

  // 点赞归属记录在 store 内：同一评论重复触发只生效一次，两个视图共享同一份状态
  likeReview: (reviewId: string) => {
    if (get().likedReviewIds.includes(reviewId)) return;
    set(state => ({
      likedReviewIds: [...state.likedReviewIds, reviewId],
      reviews: state.reviews.map(r =>
        r.id === reviewId ? { ...r, likes: r.likes + 1 } : r
      ),
    }));
  },

  isReviewLiked: (reviewId: string) => {
    return get().likedReviewIds.includes(reviewId);
  },

  getBookById: (bookId: string) => {
    return get().allBooks.find(b => b.id === bookId);
  },

  getReviewsByBookId: (bookId: string) => {
    return getCachedReviewsByBook(get().reviews, bookId);
  },

  getTopReviews: () => {
    return getCachedTopReviews(get().reviews);
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
