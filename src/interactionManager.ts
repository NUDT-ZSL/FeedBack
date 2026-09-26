import { eventBus, BubbleData } from './eventBus'

export class InteractionManager {
  private canvas: HTMLCanvasElement
  private bubbles: BubbleData[] = []
  private cards: Array<{ id: string; bubbleId: string; x: number; y: number; sentence: string; progress: number }> = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('click', this.handleClick.bind(this))
    eventBus.on('update', this.handleUpdate.bind(this))
  }

  private handleUpdate(data: {
    bubbles: BubbleData[]
    particles: Array<{
      id: string
      x: number
      y: number
      vx: number
      vy: number
      color: string
      diameter: number
      life: number
      maxLife: number
    }>
    ripples: Array<{ id: string; x: number; y: number; color: string; progress: number }>
    cards: Array<{ id: string; bubbleId: string; x: number; y: number; sentence: string; progress: number }>
  }): void {
    this.bubbles = data.bubbles
    this.cards = data.cards
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    const scaleX = this.canvas.width / rect.width
    const scaleY = this.canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    for (const card of this.cards) {
      if (card.progress < 1) continue

      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = '14px sans-serif'
      const maxWidth = 300
      const padding = 16
      const lineHeight = 1.8 * 14
      const words = card.sentence.split('')
      let line = ''
      let lineCount = 1

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n]
        const metrics = ctx.measureText(testLine)
        if (metrics.width > maxWidth - padding * 2 && n > 0) {
          line = words[n]
          lineCount++
        } else {
          line = testLine
        }
      }

      const cardWidth = Math.min(maxWidth, ctx.measureText(card.sentence).width + padding * 2)
      const cardHeight = lineCount * lineHeight + padding * 2
      const cardX = card.x - cardWidth / 2
      const cardY = card.y - cardHeight / 2 - 60

      if (x >= cardX && x <= cardX + cardWidth && y >= cardY && y <= cardY + cardHeight) {
        eventBus.emit('click', { bubbleId: card.bubbleId })
        return
      }
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i]
      if (bubble.isPopping || bubble.spawnProgress < 1) continue

      const dx = x - bubble.x
      const dy = y - bubble.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= bubble.diameter / 2) {
        eventBus.emit('click', { bubbleId: bubble.id })
        return
      }
    }
  }
}
