import { useState, useEffect, useRef, useCallback } from 'react';
import type { Task, TimerState, TimerControl, PersistedConfig } from '../types';
import {
  createInitialState,
  startTimer,
  pauseTimer,
  resetTimer,
  tickTimer,
  setDuration,
  restoreTimerState,
  configFromState,
} from '../timerLogic';
import { createConfigStore, type ConfigStore } from '../persistence';

export function useTimer(initialMinutes: number): {
  state: TimerState;
  control: TimerControl;
  saveConfig: (tasks: Task[]) => void;
  loadConfig: () => PersistedConfig | null;
} {
  const [state, setState] = useState<TimerState>(() => createInitialState(initialMinutes));

  const storeRef = useRef<ConfigStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createConfigStore(window.localStorage);
  }
  const store = storeRef.current;

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const playBeep = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1);
    } catch (e) {
      console.log('Audio not supported');
    }
  }, []);

  const start = useCallback(() => {
    setState(prev => startTimer(prev));
  }, []);

  const pause = useCallback(() => {
    setState(prev => pauseTimer(prev));
  }, []);

  const reset = useCallback(() => {
    setState(prev => resetTimer(prev));
  }, []);

  const setTime = useCallback((minutes: number) => {
    setState(prev => setDuration(prev, minutes));
  }, []);

  const restore = useCallback((config: PersistedConfig) => {
    setState(restoreTimerState(config, initialMinutes));
  }, [initialMinutes]);

  useEffect(() => {
    if (!state.isRunning || state.isPaused) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setState(prev => tickTimer(prev).state);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [state.isRunning, state.isPaused]);

  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    if (prev.isRunning && !state.isRunning && state.timeLeft === 0) {
      playBeep();
    }
    prevStateRef.current = state;
  }, [state, playBeep]);

  const saveConfig = useCallback((tasks: Task[]) => {
    store.save(configFromState(stateRef.current, tasks));
  }, [store]);

  const loadConfig = useCallback((): PersistedConfig | null => {
    return store.load();
  }, [store]);

  useEffect(() => {
    const handleBeforeUnload = () => store.flush();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      store.flush();
    };
  }, [store]);

  return {
    state,
    control: { start, pause, reset, setTime, restore },
    saveConfig,
    loadConfig,
  };
}
