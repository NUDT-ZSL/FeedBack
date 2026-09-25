import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimerState, TimerControl } from '../types';
import {
  createInitialState,
  timerStart,
  timerPause,
  timerReset,
  timerSetTime,
  timerTick,
} from '../timerStateMachine';
import { STORAGE_KEY, serializeConfig, parseConfig } from '../configStorage';
import type { Task } from '../types';

export function useTimer(initialMinutes: number): {
  state: TimerState;
  control: TimerControl;
  saveConfig: (tasks: Task[]) => void;
  loadConfig: () => { time: number; tasks: Task[] } | null;
} {
  const [state, setState] = useState<TimerState>(() =>
    createInitialState(initialMinutes),
  );

  const intervalRef = useRef<number | null>(null);
  const onEndRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

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
    setState(prev => timerStart(prev));
  }, []);

  const pause = useCallback(() => {
    setState(prev => timerPause(prev));
    clearTimer();
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setState(prev => timerReset(prev));
  }, [clearTimer]);

  const setTime = useCallback((minutes: number) => {
    clearTimer();
    setState(timerSetTime(minutes));
  }, [clearTimer]);

  const saveConfig = useCallback((tasks: Task[]) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        serializeConfig(state.initialTime, tasks),
      );
    } catch (e) {
      console.log('Failed to save config');
    }
  }, [state.initialTime]);

  const loadConfig = useCallback(() => {
    return parseConfig(localStorage.getItem(STORAGE_KEY), initialMinutes);
  }, [initialMinutes]);

  useEffect(() => {
    if (state.isRunning && !state.isPaused) {
      intervalRef.current = window.setInterval(() => {
        setState(prev => {
          const next = timerTick(prev);
          if (next.timeLeft === 0 && prev.timeLeft > 0) {
            clearTimer();
            onEndRef.current?.();
            playBeep();
          }
          return next;
        });
      }, 1000);
    }

    return () => clearTimer();
  }, [state.isRunning, state.isPaused, clearTimer, playBeep]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return {
    state,
    control: { start, pause, reset, setTime },
    saveConfig,
    loadConfig,
  };
}
