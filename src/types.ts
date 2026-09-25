export interface Task {
  id: string;
  name: string;
  duration: number;
}

export interface TaskWithProgress extends Task {
  status: 'pending' | 'active' | 'completed';
  remainingTime: number;
  progress: number;
}

export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  timeLeft: number;
  initialTime: number;
}

export type TimerControl = {
  start: () => void;
  pause: () => void;
  reset: () => void;
  setTime: (minutes: number) => void;
};
