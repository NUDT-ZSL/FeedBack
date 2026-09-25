import type { SharedState } from '../types'
import { eventBus } from '../utils/eventBus'
import { ParticleModule } from '../particleSystem/particleModule'
import { RenderModule } from '../renderer/renderModule'
import { HistoryBuffer } from './historyBuffer'

/**
 * Coordinates pause / resume / single-step / reset / timeline scrubbing.
 * While paused the render loop keeps running (trail, HUD, mode transitions)
 * but physics is frozen; scrubbing only swaps a read-only frame override
 * into the renderer and never mutates live particle state.
 */
export class TimeController {
  private state: SharedState
  private particleModule: ParticleModule
  private renderModule: RenderModule
  private history: HistoryBuffer

  private paused: boolean = false
  private scrubbing: boolean = false

  private pauseBtn: HTMLButtonElement | null = null
  private stepBtn: HTMLButtonElement | null = null
  private resetBtn: HTMLButtonElement | null = null
  private timeline: HTMLInputElement | null = null
  private timelineLabel: HTMLElement | null = null

  constructor(
    state: SharedState,
    particleModule: ParticleModule,
    renderModule: RenderModule,
    history: HistoryBuffer
  ) {
    this.state = state
    this.particleModule = particleModule
    this.renderModule = renderModule
    this.history = history

    this.bindDom()

    eventBus.on('physics-step', () => {
      this.history.record(this.state.particles, this.state.collisionCount)
      this.syncTimeline()
    })

    eventBus.on('reset-request', () => {
      this.reset()
    })
  }

  get isPaused(): boolean {
    return this.paused
  }

  private bindDom(): void {
    this.pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement | null
    this.stepBtn = document.getElementById('btn-step') as HTMLButtonElement | null
    this.resetBtn = document.getElementById('btn-reset') as HTMLButtonElement | null
    this.timeline = document.getElementById('timeline') as HTMLInputElement | null
    this.timelineLabel = document.getElementById('timeline-label')

    this.pauseBtn?.addEventListener('click', () => this.togglePause())
    this.stepBtn?.addEventListener('click', () => this.step())
    this.resetBtn?.addEventListener('click', () => this.reset())

    if (this.timeline) {
      this.timeline.addEventListener('input', () => this.onScrub())
      this.timeline.addEventListener('change', () => this.endScrub())
    }

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        this.togglePause()
      } else if (e.code === 'ArrowRight' && this.paused) {
        e.preventDefault()
        this.step()
      }
    })

    this.updateUi()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.particleModule.setPaused(true)
    eventBus.emit('pause-change', { paused: true })
    this.updateUi()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.endScrub()
    this.particleModule.setPaused(false)
    eventBus.emit('pause-change', { paused: false })
    this.updateUi()
  }

  togglePause(): void {
    if (this.paused) {
      this.resume()
    } else {
      this.pause()
    }
  }

  /** Single-step always advances exactly one fixed physics timestep. */
  step(): void {
    if (!this.paused) {
      this.pause()
    }
    this.endScrub()
    this.particleModule.stepOnce()
  }

  /** True reset: rebuild particles, zero collisions, clear history. */
  reset(): void {
    this.endScrub()
    this.history.clear()
    this.particleModule.reset()
    eventBus.emit('system-reset', {})
    this.updateUi()
  }

  private onScrub(): void {
    if (!this.paused || !this.timeline) return
    const index = parseInt(this.timeline.value, 10)
    const frame = this.history.getFrame(index)
    if (!frame) return
    this.scrubbing = true
    this.renderModule.setFrameOverride(frame.positions, frame.collisionCount)
    this.updateLabel(index)
  }

  private endScrub(): void {
    if (!this.scrubbing && !this.renderModule.hasFrameOverride()) {
      this.syncTimeline()
      return
    }
    this.scrubbing = false
    this.renderModule.clearFrameOverride()
    this.syncTimeline()
  }

  private syncTimeline(): void {
    if (!this.timeline) return
    const max = Math.max(0, this.history.length - 1)
    this.timeline.max = String(max)
    if (!this.scrubbing) {
      this.timeline.value = String(max)
      this.updateLabel(max)
    }
  }

  private updateLabel(index: number): void {
    if (!this.timelineLabel) return
    const frame = this.history.getFrame(index)
    const total = this.history.length
    const collisions = frame ? frame.collisionCount : 0
    this.timelineLabel.textContent = `帧 ${total === 0 ? 0 : index + 1}/${total} · 碰撞 ${collisions}`
  }

  private updateUi(): void {
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.paused ? '继续' : '暂停'
      this.pauseBtn.classList.toggle('paused', this.paused)
    }
    if (this.stepBtn) {
      this.stepBtn.disabled = false
    }
    if (this.timeline) {
      this.timeline.disabled = !this.paused
    }
    this.syncTimeline()
  }
}
