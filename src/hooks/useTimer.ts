import { useReducer, useEffect, useRef, useCallback } from 'react';
import type { TimerState, TimerControl } from '../types';
import { timerReducer } from '../core/timerCore';

function createInitialState(initialMinutes: number): TimerState {
  const seconds = initialMinutes * 60;
  return {
    isRunning: false,
    isPaused: false,
    timeLeft: seconds,
    initialTime: seconds,
  };
}

export function useTimer(initialMinutes: number): {
  state: TimerState;
  control: TimerControl;
  restore: (snapshot: TimerState) => void;
} {
  const [state, dispatch] = useReducer(
    timerReducer,
    initialMinutes,
    createInitialState,
  );

  const playBeep = useCallback(() => {
    try {
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextCtor();
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
    } catch {
      console.log('Audio not supported');
    }
  }, []);

  useEffect(() => {
    if (!state.isRunning || state.isPaused) {
      return;
    }
    const intervalId = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [state.isRunning, state.isPaused]);

  const prevStateRef = useRef(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    if (
      prev.isRunning &&
      !state.isRunning &&
      prev.timeLeft > 0 &&
      state.timeLeft === 0
    ) {
      playBeep();
    }
    prevStateRef.current = state;
  }, [state, playBeep]);

  const start = useCallback(() => {
    dispatch({ type: 'start' });
  }, []);
  const pause = useCallback(() => {
    dispatch({ type: 'pause' });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);
  const setTime = useCallback((minutes: number) => {
    dispatch({ type: 'setTime', minutes });
  }, []);
  const restore = useCallback((snapshot: TimerState) => {
    dispatch({ type: 'restore', snapshot });
  }, []);

  return {
    state,
    control: { start, pause, reset, setTime },
    restore,
  };
}
