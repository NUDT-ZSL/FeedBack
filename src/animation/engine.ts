export type EasingFn = (t: number) => number;

export interface AnimationSpec {
  key: string;
  delay?: number;
  duration: number;
  ease?: EasingFn;
  onStart?: () => void;
  onUpdate?: (eased: number, progress: number, random: () => number) => void;
  onComplete?: () => void;
}

interface ActiveAnimation {
  spec: AnimationSpec;
  startAt: number;
  started: boolean;
}

export const DEFAULT_ANIMATION_SEED = 0xd06006;

const createRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const identity: EasingFn = (t) => t;

export class AnimationEngine {
  private animations = new Map<string, ActiveAnimation>();
  private clock = 0;
  private random = createRng(DEFAULT_ANIMATION_SEED);

  readonly nextRandom = (): number => this.random();

  reseed(seed: number = DEFAULT_ANIMATION_SEED): void {
    this.random = createRng(seed);
  }

  get size(): number {
    return this.animations.size;
  }

  has(key: string): boolean {
    return this.animations.has(key);
  }

  schedule(spec: AnimationSpec): void {
    this.animations.set(spec.key, {
      spec,
      startAt: this.clock + (spec.delay ?? 0),
      started: false,
    });
  }

  cancel(key: string): void {
    this.animations.delete(key);
  }

  cancelAll(): void {
    this.animations.clear();
  }

  tick(dtMs: number): void {
    this.clock += dtMs;
    if (this.animations.size === 0) return;

    for (const [key, anim] of [...this.animations]) {
      if (this.clock < anim.startAt) continue;
      if (!anim.started) {
        anim.started = true;
        anim.spec.onStart?.();
      }
      const { duration } = anim.spec;
      const progress =
        duration <= 0 ? 1 : Math.min((this.clock - anim.startAt) / duration, 1);
      const eased = (anim.spec.ease ?? identity)(progress);
      anim.spec.onUpdate?.(eased, progress, this.nextRandom);
      if (progress >= 1 && this.animations.get(key) === anim) {
        this.animations.delete(key);
        anim.spec.onComplete?.();
      }
    }
  }
}
