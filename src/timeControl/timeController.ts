import type { SharedState } from '../types'
import { eventBus } from '../utils/eventBus'

export interface TimeSnapshot {
  positions: Float32Array
  collisionCount: number
}

const MAX_HISTORY_FRAMES = 600

export class TimeController {
  private state: SharedState
  private paused: boolean = false
  private history: TimeSnapshot[] = []
  private reviewIndex: number | null = null

  constructor(state: SharedState) {
    this.state = state
  }

  isPaused(): boolean {
    return this.paused
  }

  isReviewing(): boolean {
    return this.reviewIndex !== null
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    eventBus.emit('pause-change', { paused: true })
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.reviewIndex = null
    eventBus.emit('pause-change', { paused: false })
    this.emitHistoryChange()
  }

  toggle(): void {
    if (this.paused) {
      this.resume()
    } else {
      this.pause()
    }
  }

  recordStep(): void {
    const particles = this.state.particles
    const positions = new Float32Array(particles.length * 3)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      positions[i * 3] = p.position.x
      positions[i * 3 + 1] = p.position.y
      positions[i * 3 + 2] = p.position.z
    }
    this.history.push({ positions, collisionCount: this.state.collisionCount })
    if (this.history.length > MAX_HISTORY_FRAMES) {
      this.history.shift()
    }
    if (this.reviewIndex !== null) {
      this.reviewIndex = null
    }
    this.emitHistoryChange()
  }

  getHistoryLength(): number {
    return this.history.length
  }

  getReviewIndex(): number | null {
    return this.reviewIndex
  }

  getReviewSnapshot(): TimeSnapshot | null {
    if (this.reviewIndex === null) return null
    return this.history[this.reviewIndex] ?? null
  }

  setReviewIndex(index: number): void {
    if (!this.paused || this.history.length === 0) return
    const clamped = Math.max(0, Math.min(this.history.length - 1, Math.round(index)))
    if (this.reviewIndex === clamped) return
    this.reviewIndex = clamped
    this.emitHistoryChange()
  }

  clearReview(): void {
    if (this.reviewIndex === null) return
    this.reviewIndex = null
    this.emitHistoryChange()
  }

  clearHistory(): void {
    this.history = []
    this.reviewIndex = null
    this.emitHistoryChange()
  }

  private emitHistoryChange(): void {
    eventBus.emit('history-change', {
      length: this.history.length,
      reviewIndex: this.reviewIndex
    })
  }
}
