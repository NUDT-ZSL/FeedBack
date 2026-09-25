import type { Particle } from '../types'

export interface FrameSnapshot {
  positions: Float32Array
  collisionCount: number
}

/**
 * Ring buffer of per-physics-step snapshots used for timeline scrubbing.
 * Snapshots are immutable copies; reading them never touches live state.
 */
export class HistoryBuffer {
  private frames: FrameSnapshot[] = []
  private readonly capacity: number

  constructor(capacity: number = 600) {
    this.capacity = capacity
  }

  record(particles: Particle[], collisionCount: number): void {
    const positions = new Float32Array(particles.length * 3)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i].position
      positions[i * 3] = p.x
      positions[i * 3 + 1] = p.y
      positions[i * 3 + 2] = p.z
    }
    this.frames.push({ positions, collisionCount })
    if (this.frames.length > this.capacity) {
      this.frames.splice(0, this.frames.length - this.capacity)
    }
  }

  clear(): void {
    this.frames.length = 0
  }

  get length(): number {
    return this.frames.length
  }

  getFrame(index: number): FrameSnapshot | undefined {
    if (index < 0 || index >= this.frames.length) return undefined
    return this.frames[index]
  }

  get latest(): FrameSnapshot | undefined {
    return this.frames[this.frames.length - 1]
  }
}
