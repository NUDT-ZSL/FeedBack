import { v3, type Vec3 } from './math3';

export const DEFAULT_TWEEN_DURATION_MS = 2000;

export interface ViewTween {
  startPosition: Vec3;
  endPosition: Vec3;
  startTarget: Vec3;
  endTarget: Vec3;
  durationMs: number;
}

export interface ViewTweenSample {
  progress: number;
  eased: number;
  position: Vec3;
  target: Vec3;
  done: boolean;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createViewTween(
  startPosition: Vec3,
  endPosition: Vec3,
  startTarget: Vec3,
  endTarget: Vec3,
  durationMs: number = DEFAULT_TWEEN_DURATION_MS
): ViewTween {
  return {
    startPosition: [...startPosition],
    endPosition: [...endPosition],
    startTarget: [...startTarget],
    endTarget: [...endTarget],
    durationMs
  };
}

export function sampleViewTween(tween: ViewTween, elapsedMs: number): ViewTweenSample {
  const clamped = Math.max(0, elapsedMs);
  const progress = Math.min(clamped / tween.durationMs, 1);
  const eased = easeInOutCubic(progress);
  return {
    progress,
    eased,
    position: v3.lerp(tween.startPosition, tween.endPosition, eased),
    target: v3.lerp(tween.startTarget, tween.endTarget, eased),
    done: progress >= 1
  };
}
