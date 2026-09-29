import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { Space, Booking, Activity, AdminAction } from '@/types';
import * as api from '@/services/api';

interface AppState {
  spaces: Space[];
  bookings: Booking[];
  activities: Activity[];
  auditLog: AdminAction[];
  currentUser: { id: string; name: string };
  loading: boolean;
}

type Action =
  | { type: 'SET_SPACES'; payload: Space[] }
  | { type: 'SET_BOOKINGS'; payload: Booking[] }
  | { type: 'ADD_BOOKING'; payload: Booking }
  | { type: 'UPDATE_BOOKING'; payload: Booking }
  | { type: 'CANCEL_BOOKING'; payload: string }
  | { type: 'SET_ACTIVITIES'; payload: Activity[] }
  | { type: 'ADD_AUDIT_ACTION'; payload: AdminAction }
  | { type: 'SET_AUDIT_LOG'; payload: AdminAction[] }
  | { type: 'SET_LOADING'; payload: boolean };

const initialState: AppState = {
  spaces: [],
  bookings: [],
  activities: [],
  auditLog: [],
  currentUser: { id: 'user1', name: '居民小明' },
  loading: true,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SPACES':
      return { ...state, spaces: action.payload };
    case 'SET_BOOKINGS':
      return { ...state, bookings: action.payload };
    case 'ADD_BOOKING':
      return { ...state, bookings: [...state.bookings, action.payload] };
    case 'UPDATE_BOOKING':
      return {
        ...state,
        bookings: state.bookings.map((b) => (b.id === action.payload.id ? action.payload : b)),
      };
    case 'CANCEL_BOOKING':
      return {
        ...state,
        bookings: state.bookings.map((b) => (b.id === action.payload ? { ...b, status: 'cancelled' as const } : b)),
      };
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.payload };
    case 'ADD_AUDIT_ACTION':
      return { ...state, auditLog: [...state.auditLog, action.payload] };
    case 'SET_AUDIT_LOG':
      return { ...state, auditLog: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    default:
      return state;
  }
}

interface AppContextValue extends AppState {
  refreshSpaces: () => Promise<void>;
  refreshBookings: () => Promise<void>;
  refreshActivities: () => Promise<void>;
  refreshAuditLog: () => Promise<void>;
  createBooking: (spaceId: string, startTime: string, endTime: string, purpose: string) => Promise<Booking>;
  cancelBooking: (bookingId: string) => Promise<void>;
  forceCancelBooking: (bookingId: string) => Promise<void>;
  rateBooking: (bookingId: string, rating: number, comment: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const refreshSpaces = async () => {
    const spaces = await api.fetchSpaces();
    dispatch({ type: 'SET_SPACES', payload: spaces });
  };

  const refreshBookings = async () => {
    const bookings = await api.fetchBookings();
    dispatch({ type: 'SET_BOOKINGS', payload: bookings });
  };

  const refreshActivities = async () => {
    const activities = await api.fetchInterestingActivities();
    dispatch({ type: 'SET_ACTIVITIES', payload: activities });
  };

  const refreshAuditLog = async () => {
    const log = await api.fetchAuditLog();
    dispatch({ type: 'SET_AUDIT_LOG', payload: log });
  };

  const createBooking = async (spaceId: string, startTime: string, endTime: string, purpose: string) => {
    const booking = await api.createBooking({
      userId: state.currentUser.id,
      spaceId,
      startTime,
      endTime,
      purpose,
    });
    dispatch({ type: 'ADD_BOOKING', payload: booking });
    await refreshSpaces();
    return booking;
  };

  const cancelBooking = async (bookingId: string) => {
    await api.cancelBooking(bookingId);
    dispatch({ type: 'CANCEL_BOOKING', payload: bookingId });
  };

  const forceCancelBooking = async (bookingId: string) => {
    const action = await api.forceCancelBooking(bookingId, 'admin1');
    dispatch({ type: 'CANCEL_BOOKING', payload: bookingId });
    dispatch({ type: 'ADD_AUDIT_ACTION', payload: action });
  };

  const rateBooking = async (bookingId: string, rating: number, comment: string) => {
    const updated = await api.rateBooking(bookingId, rating, comment);
    dispatch({ type: 'UPDATE_BOOKING', payload: updated });
  };

  useEffect(() => {
    (async () => {
      dispatch({ type: 'SET_LOADING', payload: true });
      await Promise.all([refreshSpaces(), refreshBookings(), refreshActivities()]);
      dispatch({ type: 'SET_LOADING', payload: false });
    })();
  }, []);

  return (
    <AppContext.Provider
      value={{
        ...state,
        refreshSpaces,
        refreshBookings,
        refreshActivities,
        refreshAuditLog,
        createBooking,
        cancelBooking,
        forceCancelBooking,
        rateBooking,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
