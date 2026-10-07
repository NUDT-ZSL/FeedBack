import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from 'react';
import {
  StudioAction,
  StudioState,
  initialStudioState,
  reduceStudio,
  getCurrentWork,
  getSavedWorks,
} from './lanternStore';
import { LanternWork } from '../types';

interface StudioContextValue {
  state: StudioState;
  current: LanternWork | null;
  saved: LanternWork[];
  dispatch: (action: StudioAction) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const reducer = (state: StudioState, action: StudioAction): StudioState =>
  reduceStudio(state, action);

export const LanternStudioProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatchBase] = useReducer(reducer, initialStudioState);

  const dispatch = useCallback((action: StudioAction) => {
    dispatchBase(action);
  }, []);

  const value = useMemo<StudioContextValue>(
    () => ({
      state,
      current: getCurrentWork(state),
      saved: getSavedWorks(state),
      dispatch,
    }),
    [state, dispatch]
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
};

export const useLanternStudio = (): StudioContextValue => {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error('useLanternStudio must be used within LanternStudioProvider');
  }
  return ctx;
};
