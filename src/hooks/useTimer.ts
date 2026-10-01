import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimerState, TimerControl } from '../types';

const STORAGE_KEY = 'classroom-timer-config';

export function useTimer(initialMinutes: number): {
  state: TimerState;
  control: TimerControl;
  saveConfig: (tasks: any[]) => void;
  loadConfig: () => { time: number; tasks: any[] } | null;
} {
  const [state, setState] = useState<TimerState>({
    isRunning: false,
    isPaused: false,
    timeLeft: initialMinutes * 60,
    initialTime: initialMinutes * 60,
  });

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
    setState(prev => {
      if (prev.timeLeft <= 0) {
        return prev;
      }
      return { ...prev, isRunning: true, isPaused: false };
    });
  }, []);

  const pause = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: false, isPaused: true }));
    clearTimer();
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setState(prev => ({
      isRunning: false,
      isPaused: false,
      timeLeft: prev.initialTime,
      initialTime: prev.initialTime,
    }));
  }, [clearTimer]);

  const setTime = useCallback((minutes: number) => {
    const seconds = minutes * 60;
    clearTimer();
    setState({
      isRunning: false,
      isPaused: false,
      timeLeft: seconds,
      initialTime: seconds,
    });
  }, [clearTimer]);

  const saveConfig = useCallback((tasks: any[]) => {
    try {
      const config = {
        time: state.initialTime / 60,
        tasks,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.log('Failed to save config');
    }
  }, [state.initialTime]);

  const loadConfig = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const config = JSON.parse(saved);
        return {
          time: config.time || initialMinutes,
          tasks: config.tasks || [],
        };
      }
    } catch (e) {
      console.log('Failed to load config');
    }
    return null;
  }, [initialMinutes]);

  useEffect(() => {
    if (state.isRunning && !state.isPaused) {
      intervalRef.current = window.setInterval(() => {
        setState(prev => {
          if (prev.timeLeft <= 1) {
            clearTimer();
            onEndRef.current?.();
            playBeep();
            return { ...prev, timeLeft: 0, isRunning: false };
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
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
