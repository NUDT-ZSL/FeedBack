import { eventBus } from '../utils/eventBus'
import type { TimeController } from '../timeControl/timeController'

export class TimeControlPanel {
  private timeController: TimeController
  private onStep: () => void

  private pauseBtn: HTMLButtonElement | null
  private stepBtn: HTMLButtonElement | null
  private timelineContainer: HTMLElement | null
  private timeline: HTMLInputElement | null
  private timelineLabel: HTMLElement | null
  private statusEl: HTMLElement | null

  constructor(timeController: TimeController, onStep: () => void) {
    this.timeController = timeController
    this.onStep = onStep

    this.pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement | null
    this.stepBtn = document.getElementById('btn-step') as HTMLButtonElement | null
    this.timelineContainer = document.getElementById('timeline-container')
    this.timeline = document.getElementById('timeline') as HTMLInputElement | null
    this.timelineLabel = document.getElementById('timeline-label')
    this.statusEl = document.getElementById('time-status')

    this.pauseBtn?.addEventListener('click', () => this.timeController.toggle())
    this.stepBtn?.addEventListener('click', () => this.step())

    if (this.timeline) {
      this.timeline.addEventListener('input', () => {
        if (!this.timeline) return
        this.timeController.setReviewIndex(Number(this.timeline.value))
      })
      this.timeline.addEventListener('change', () => {
        this.timeController.clearReview()
      })
    }

    window.addEventListener('keydown', (e) => this.onKeyDown(e))

    eventBus.on('pause-change', () => this.refresh())
    eventBus.on('history-change', () => this.refresh())

    this.refresh()
  }

  private step(): void {
    if (!this.timeController.isPaused()) {
      this.timeController.pause()
    }
    this.onStep()
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return
    }
    if (e.code === 'Space') {
      e.preventDefault()
      this.timeController.toggle()
    } else if (e.code === 'ArrowRight' || e.code === 'Period') {
      e.preventDefault()
      this.step()
    }
  }

  private refresh(): void {
    const paused = this.timeController.isPaused()
    const reviewing = this.timeController.isReviewing()
    const length = this.timeController.getHistoryLength()

    if (this.pauseBtn) {
      this.pauseBtn.textContent = paused ? '继续' : '暂停'
      this.pauseBtn.classList.toggle('active', paused)
    }

    if (this.statusEl) {
      this.statusEl.textContent = reviewing ? '回看中' : paused ? '已暂停' : '运行中'
      this.statusEl.classList.toggle('reviewing', reviewing)
    }

    const showTimeline = paused && length > 0
    if (this.timelineContainer) {
      this.timelineContainer.classList.toggle('hidden', !showTimeline)
    }

    if (showTimeline && this.timeline) {
      const reviewIndex = this.timeController.getReviewIndex()
      const current = reviewIndex !== null ? reviewIndex : length - 1
      this.timeline.max = String(length - 1)
      this.timeline.value = String(current)
      if (this.timelineLabel) {
        const back = length - 1 - current
        this.timelineLabel.textContent = back === 0 ? '当前帧' : `-${back} 帧`
      }
    }
  }
}
