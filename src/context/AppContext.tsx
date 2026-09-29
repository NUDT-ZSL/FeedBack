import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Annotation, Rating, ToastMessage } from '../types';

interface AppContextType {
  annotations: Annotation[];
  ratings: Rating[];
  toasts: ToastMessage[];
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'createdAt'>) => void;
  getAnnotations: (storyId: string, chapterId: string, paragraphIndex: number) => Annotation[];
  hasAnnotation: (storyId: string, chapterId: string, paragraphIndex: number) => boolean;
  addRating: (rating: Omit<Rating, 'id' | 'createdAt'>) => void;
  hasRated: (storyId: string, chapterId: string) => boolean;
  getChapterRating: (storyId: string, chapterId: string) => { average: number; count: number; userScore?: number };
  showToast: (message: string, type?: ToastMessage['type']) => void;
  removeToast: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addAnnotation = useCallback((annotation: Omit<Annotation, 'id' | 'createdAt'>) => {
    const newAnnotation: Annotation = {
      ...annotation,
      id: `anno-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    setAnnotations(prev => [...prev, newAnnotation]);
  }, []);

  const getAnnotations = useCallback((storyId: string, chapterId: string, paragraphIndex: number) => {
    return annotations.filter(
      a => a.storyId === storyId && a.chapterId === chapterId && a.paragraphIndex === paragraphIndex
    );
  }, [annotations]);

  const hasAnnotation = useCallback((storyId: string, chapterId: string, paragraphIndex: number) => {
    return annotations.some(
      a => a.storyId === storyId && a.chapterId === chapterId && a.paragraphIndex === paragraphIndex
    );
  }, [annotations]);

  const addRating = useCallback((rating: Omit<Rating, 'id' | 'createdAt'>) => {
    const newRating: Rating = {
      ...rating,
      id: `rating-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    setRatings(prev => {
      const filtered = prev.filter(
        r => !(r.storyId === rating.storyId && r.chapterId === rating.chapterId)
      );
      return [...filtered, newRating];
    });
  }, []);

  const hasRated = useCallback((storyId: string, chapterId: string) => {
    return ratings.some(r => r.storyId === storyId && r.chapterId === chapterId);
  }, [ratings]);

  const getChapterRating = useCallback((storyId: string, chapterId: string) => {
    const chapterRatings = ratings.filter(
      r => r.storyId === storyId && r.chapterId === chapterId
    );
    const userRating = chapterRatings[0];
    return {
      average: userRating ? userRating.score : 0,
      count: chapterRatings.length > 0 ? 1 : 0,
      userScore: userRating?.score
    };
  }, [ratings]);

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <AppContext.Provider
      value={{
        annotations,
        ratings,
        toasts,
        addAnnotation,
        getAnnotations,
        hasAnnotation,
        addRating,
        hasRated,
        getChapterRating,
        showToast,
        removeToast
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
