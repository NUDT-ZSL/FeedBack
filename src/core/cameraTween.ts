import * as THREE from 'three';
import { easeInOutCubic, clamp01 } from './easing';

export interface CameraTweenSample {
  position: THREE.Vector3;
  target: THREE.Vector3;
  progress: number;
  done: boolean;
}

export const VIEW_TWEEN_DURATION_MS = 2000;

export class CameraTween {
  readonly startPosition: THREE.Vector3;
  readonly endPosition: THREE.Vector3;
  readonly startTarget: THREE.Vector3;
  readonly endTarget: THREE.Vector3;
  readonly durationMs: number;
  private elapsedMs = 0;

  constructor(
    startPosition: THREE.Vector3,
    endPosition: THREE.Vector3,
    startTarget: THREE.Vector3,
    endTarget: THREE.Vector3,
    durationMs: number = VIEW_TWEEN_DURATION_MS
  ) {
    this.startPosition = startPosition.clone();
    this.endPosition = endPosition.clone();
    this.startTarget = startTarget.clone();
    this.endTarget = endTarget.clone();
    this.durationMs = durationMs;
  }

  sampleAt(elapsedMs: number): CameraTweenSample {
    const progress = clamp01(elapsedMs / this.durationMs);
    const eased = easeInOutCubic(progress);
    return {
      position: new THREE.Vector3().lerpVectors(this.startPosition, this.endPosition, eased),
      target: new THREE.Vector3().lerpVectors(this.startTarget, this.endTarget, eased),
      progress,
      done: progress >= 1
    };
  }

  advance(deltaMs: number): CameraTweenSample {
    this.elapsedMs += deltaMs;
    return this.sampleAt(this.elapsedMs);
  }

  get elapsed(): number {
    return this.elapsedMs;
  }
}
