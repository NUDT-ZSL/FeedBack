import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { Book, Annotation, AppState, AnnotationColor } from '../types';
import { MOCK_BOOKS } from '../types';

const MOCK_USER_ID = 'user-' + uuidv4();

const loadFromStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const saveToStorage = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
};

export const useStore = create<AppState>((set, get) => ({
  books: MOCK_BOOKS,
  borrowedBooks: loadFromStorage<string[]>('borrowedBooks', []),
  annotations: loadFromStorage<Annotation[]>('annotations', []),
  currentBook: null,
  currentPage: 1,
  userId: MOCK_USER_ID,
  searchQuery: '',

  setBooks: (books: Book[]) => set({ books }),

  setCurrentBook: (book: Book | null) => set({ currentBook: book, currentPage: 1 }),

  setCurrentPage: (page: number) => set({ currentPage: page }),

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  borrowBook: async (bookId: string): Promise<boolean> => {
    const { borrowedBooks } = get();
    
    try {
      const response = await fetch('/api/borrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, userId: MOCK_USER_ID }),
      });

      if (!response.ok) {
        throw new Error('Failed to borrow book');
      }
    } catch (e) {
      console.warn('API not available, using localStorage fallback');
    }

    if (!borrowedBooks.includes(bookId)) {
      const newBorrowedBooks = [...borrowedBooks, bookId];
      set({ borrowedBooks: newBorrowedBooks });
      saveToStorage('borrowedBooks', newBorrowedBooks);
    }
    return true;
  },

  saveAnnotation: async (annotation: Omit<Annotation, '_id' | 'createdAt'>): Promise<boolean> => {
    const newAnnotation: Annotation = {
      ...annotation,
      _id: uuidv4(),
      createdAt: new Date(),
    };

    try {
      const response = await fetch('/api/annotation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotation),
      });

      if (!response.ok) {
        throw new Error('Failed to save annotation');
      }
    } catch (e) {
      console.warn('API not available, using localStorage fallback');
    }

    const { annotations } = get();
    const existingIndex = annotations.findIndex(
      a => a.bookId === annotation.bookId && 
           a.page === annotation.page && 
           a.paragraphIndex === annotation.paragraphIndex
    );

    let newAnnotations: Annotation[];
    if (existingIndex >= 0) {
      newAnnotations = [...annotations];
      newAnnotations[existingIndex] = newAnnotation;
    } else {
      newAnnotations = [...annotations, newAnnotation];
    }

    set({ annotations: newAnnotations });
    saveToStorage('annotations', newAnnotations);
    return true;
  },

  loadAnnotations: async (bookId: string): Promise<void> => {
    try {
      const response = await fetch(`/api/annotations/${bookId}`);
      if (response.ok) {
        const data = await response.json();
        set({ annotations: data });
        saveToStorage('annotations', data);
        return;
      }
    } catch (e) {
      console.warn('API not available, using localStorage fallback');
    }

    const stored = loadFromStorage<Annotation[]>('annotations', []);
    const bookAnnotations = stored.filter(a => a.bookId === bookId);
    set({ annotations: bookAnnotations });
  },

  saveProgress: async (bookId: string, page: number): Promise<void> => {
    try {
      await fetch('/api/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, userId: MOCK_USER_ID, currentPage: page }),
      });
    } catch (e) {
      console.warn('API not available, using localStorage fallback');
    }
    saveToStorage(`progress-${bookId}`, page);
  },
}));

export const useBookAnnotations = (bookId: string) => {
  return useStore(state => 
    state.annotations.filter(a => a.bookId === bookId)
  );
};

export const useIsBookBorrowed = (bookId: string) => {
  return useStore(state => state.borrowedBooks.includes(bookId));
};

export const useFilteredBooks = () => {
  const { books, searchQuery } = useStore();
  if (!searchQuery.trim()) return books;
  
  const query = searchQuery.toLowerCase();
  return books.map(book => ({
    ...book,
    isFiltered: !book.title.toLowerCase().includes(query) && 
                !book.author.toLowerCase().includes(query),
  }));
};

export type { AnnotationColor };
