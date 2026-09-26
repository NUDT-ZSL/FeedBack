import { create } from 'zustand'

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
}

export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  imageUrl: string;
  questions: QuizQuestion[];
}

interface QuizAnswer {
  questionId: string;
  isCorrect: boolean;
}

interface AppState {
  events: TimelineEvent[];
  setEvents: (events: TimelineEvent[]) => void;
  addEvent: (event: TimelineEvent) => void;
  expandedEventId: string | null;
  setExpandedEventId: (id: string | null) => void;
  quizAnswers: QuizAnswer[];
  addQuizAnswer: (questionId: string, isCorrect: boolean) => void;
  hideMastered: boolean;
  setHideMastered: (hide: boolean) => void;
  isMastered: (event: TimelineEvent) => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  events: [],
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
  expandedEventId: null,
  setExpandedEventId: (id) =>
    set((state) => ({
      expandedEventId: state.expandedEventId === id ? null : id,
    })),
  quizAnswers: [],
  addQuizAnswer: (questionId, isCorrect) =>
    set((state) => {
      if (state.quizAnswers.some((a) => a.questionId === questionId)) {
        return state;
      }
      return { quizAnswers: [...state.quizAnswers, { questionId, isCorrect }] };
    }),
  hideMastered: false,
  setHideMastered: (hide) => set({ hideMastered: hide }),
  isMastered: (event) => {
    const { quizAnswers } = get();
    if (event.questions.length === 0) return false;
    return event.questions.every((q) =>
      quizAnswers.some((a) => a.questionId === q.id && a.isCorrect)
    );
  },
}))
