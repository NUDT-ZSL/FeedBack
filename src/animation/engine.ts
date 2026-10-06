import type { Rotation, Transform } from '../types';

// Centralized animation engine.
//
// Invariants:
// - A component is driven by at most one track at any moment. Starting a new
//   track for a component replaces (preempts) the previous one.
// - tick(now) is a pure function of the scheduled tracks and `now`; it never
//   uses wall-clock time or Math.random internally, so fixed-step offline
//   runs are fully reproducible.
// - Completing a track always settles the component at its exact target pose.

export interface Pose {
  position: Transform;
  rotation: Rotation;
}

export type TrackKind = 'disassemble' | 'flyin' | 'snap' | 'error' | 'generic';

export interface VibrationSpec {
  amplitude: number;
  freqX: number;
  phaseX: number;
  freqY: number;
  phaseY: number;
  freqZ: number;
  phaseZ: number;
}

export interface ComponentTrack {
  componentId: string;
  kind: TrackKind;
  startAt: number;
  duration: number;
  from: Pose;
  to: Pose;
  easing: (t: number) => number;
  vibration: VibrationSpec | null;
}

interface BackgroundTrack {
  startAt: number;
  duration: number;
  from: number;
  to: number;
  easing: (t: number) => number;
}

interface ScheduledCallback {
  id: number;
  at: number;
  cb: () => void;
}

export interface PoseUpdate {
  componentId: string;
  pose: Pose;
}

export interface TrackCompletion {
  componentId: string;
  kind: TrackKind;
  pose: Pose;
}

export interface TickResult {
  poseUpdates: PoseUpdate[];
  completions: TrackCompletion[];
  background: number | null;
  backgroundCompleted: boolean;
}

const clonePose = (pose: Pose): Pose => ({
  position: { ...pose.position },
  rotation: { ...pose.rotation },
});

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpPose = (from: Pose, to: Pose, t: number): Pose => ({
  position: {
    x: lerp(from.position.x, to.position.x, t),
    y: lerp(from.position.y, to.position.y, t),
    z: lerp(from.position.z, to.position.z, t),
  },
  rotation: {
    x: lerp(from.rotation.x, to.rotation.x, t),
    y: lerp(from.rotation.y, to.rotation.y, t),
    z: lerp(from.rotation.z, to.rotation.z, t),
  },
});

export class AnimationEngine {
  private tracks = new Map<string, ComponentTrack>();
  private callbacks: ScheduledCallback[] = [];
  private nextCallbackId = 1;
  private background: BackgroundTrack | null = null;

  startTrack(track: ComponentTrack): void {
    // New target preempts any in-flight track for the same component.
    this.tracks.set(track.componentId, { ...track, from: clonePose(track.from), to: clonePose(track.to) });
  }

  cancelTrack(componentId: string): void {
    this.tracks.delete(componentId);
  }

  cancelAll(): void {
    this.tracks.clear();
    this.callbacks = [];
    this.background = null;
  }

  schedule(at: number, cb: () => void): number {
    const id = this.nextCallbackId++;
    this.callbacks.push({ id, at, cb });
    return id;
  }

  cancelScheduled(): void {
    this.callbacks = [];
  }

  startBackground(startAt: number, duration: number, from: number, to: number, easing: (t: number) => number): void {
    this.background = { startAt, duration, from, to, easing };
  }

  cancelBackground(): void {
    this.background = null;
  }

  get activeTrackCount(): number {
    return this.tracks.size;
  }

  get scheduledCount(): number {
    return this.callbacks.length;
  }

  get hasBackground(): boolean {
    return this.background !== null;
  }

  hasWork(): boolean {
    return this.tracks.size > 0 || this.callbacks.length > 0 || this.background !== null;
  }

  tick(now: number): TickResult {
    const poseUpdates: PoseUpdate[] = [];
    const completions: TrackCompletion[] = [];

    for (const [componentId, track] of this.tracks) {
      if (now < track.startAt) continue;
      const t = Math.min((now - track.startAt) / track.duration, 1);
      const eased = track.easing(t);

      if (t >= 1) {
        this.tracks.delete(componentId);
        completions.push({ componentId, kind: track.kind, pose: clonePose(track.to) });
        continue;
      }

      const pose = lerpPose(track.from, track.to, eased);
      if (track.vibration) {
        const envelope = Math.sin(t * Math.PI) * track.vibration.amplitude;
        pose.position.x += envelope * Math.sin(track.vibration.freqX * t + track.vibration.phaseX);
        pose.position.y += envelope * Math.sin(track.vibration.freqY * t + track.vibration.phaseY);
        pose.position.z += envelope * Math.sin(track.vibration.freqZ * t + track.vibration.phaseZ);
      }
      poseUpdates.push({ componentId, pose });
    }

    let background: number | null = null;
    let backgroundCompleted = false;
    if (this.background) {
      const bg = this.background;
      const t = Math.min(Math.max((now - bg.startAt) / bg.duration, 0), 1);
      background = bg.from + (bg.to - bg.from) * bg.easing(t);
      if (t >= 1) {
        this.background = null;
        backgroundCompleted = true;
      }
    }

    const due = this.callbacks.filter((c) => c.at <= now).sort((a, b) => a.at - b.at);
    this.callbacks = this.callbacks.filter((c) => c.at > now);

    const result: TickResult = { poseUpdates, completions, background, backgroundCompleted };

    // Run callbacks last so they may freely schedule new work without
    // mutating collections mid-iteration.
    for (const { cb } of due) cb();

    return result;
  }
}
