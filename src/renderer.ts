import { eventBus, BubbleData, ParticleData, RippleData, CardData } from './eventBus'

interface Star {
  x: number
  y: number
  size: number
  baseBrightness: number
  phase: number
  period: number
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private bubbles: BubbleData[] = []
  private particles: ParticleData[] = []
  private ripples: RippleData[] = []
  private cards: CardData[] = []
  private stars: Star[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.initStars()
    this.setupEventListeners()
  }

  private initStars(): void {
    const starCount = Math.floor((this.canvas.width * this.canvas.height) / 8000)
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        size: 1 + Math.random() * 2,
        baseBrightness: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        period: 2 + Math.random() * 2
      })
    }
  }

  private setupEventListeners(): void {
    eventBus.on('update', this.handleUpdate.bind(this))
  }

  private handleUpdate(data: {
    bubbles: BubbleData[]
    particles: ParticleData[]
    ripples: RippleData[]
    cards: CardData[]
  }): void {
    this.bubbles = data.bubbles
    this.particles = data.particles
    this.ripples = data.ripples
    this.cards = data.cards
  }

  render(time: number): void {
    this.ctx.fillStyle = '#0A0E27'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    this.renderStars(time)
    this.renderParticles()
    this.renderBubbles()
    this.renderRipples()
    this.renderCards()
  }

  private renderStars(time: number): void {
    for (const star of this.stars) {
      const brightness = star.baseBrightness + Math.sin(star.phase + (time / 1000) * (1 / star.period) * Math.PI * 2) * 0.25
      const alpha = Math.max(0.3, Math.min(0.8, brightness))
      
      this.ctx.beginPath()
      this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)
      this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      this.ctx.fill()
    }
  }

  private renderBubbles(): void {
    for (const bubble of this.bubbles) {
      if (bubble.isPopping) {
        this.renderPoppingBubble(bubble)
      } else {
        this.renderNormalBubble(bubble)
      }
    }
  }

  private renderNormalBubble(bubble: BubbleData): void {
    const scale = bubble.spawnProgress < 1 
      ? this.elasticOut(bubble.spawnProgress) 
      : 1
    
    const radius = (bubble.diameter / 2) * scale
    const x = bubble.x
    const y = bubble.y

    const gradient = this.ctx.createRadialGradient(
      x - radius * 0.3,
      y - radius * 0.3,
      0,
      x,
      y,
      radius
    )
    gradient.addColorStop(0, this.adjustColor(bubble.color, 1.5, 0.8))
    gradient.addColorStop(0.5, this.adjustColor(bubble.color, 1.2, 0.6))
    gradient.addColorStop(1, this.adjustColor(bubble.color, 0.8, 0.4))

    this.ctx.save()
    this.ctx.globalAlpha = 0.9
    this.ctx.beginPath()
    this.ctx.arc(x, y, radius, 0, Math.PI * 2)
    this.ctx.fillStyle = gradient
    this.ctx.fill()

    this.ctx.globalAlpha = 0.6
    this.ctx.beginPath()
    this.ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.3, 0, Math.PI * 2)
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    this.ctx.fill()

    this.ctx.globalAlpha = 0.3
    this.ctx.beginPath()
    this.ctx.arc(x, y, radius + 2, 0, Math.PI * 2)
    this.ctx.strokeStyle = bubble.color
    this.ctx.lineWidth = 2
    this.ctx.stroke()

    this.ctx.restore()
  }

  private renderPoppingBubble(bubble: BubbleData): void {
    const progress = bubble.popProgress
    const radius = bubble.diameter / 2

    let shakeX = 0
    let shakeY = 0
    if (progress < 0.5) {
      const shakePhase = progress * 20
      shakeX = Math.sin(shakePhase) * 3 * (1 - progress * 2)
      shakeY = Math.cos(shakePhase) * 3 * (1 - progress * 2)
    }

    const scale = progress < 0.5 ? 1 + progress * 0.3 : 1 - (progress - 0.5) * 2
    const alpha = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2

    const x = bubble.x + shakeX
    const y = bubble.y + shakeY

    this.ctx.save()
    this.ctx.globalAlpha = alpha

    const gradient = this.ctx.createRadialGradient(
      x - radius * 0.3 * scale,
      y - radius * 0.3 * scale,
      0,
      x,
      y,
      radius * scale
    )
    gradient.addColorStop(0, this.adjustColor(bubble.color, 1.5, 0.8))
    gradient.addColorStop(0.5, this.adjustColor(bubble.color, 1.2, 0.6))
    gradient.addColorStop(1, this.adjustColor(bubble.color, 0.8, 0.4))

    this.ctx.beginPath()
    this.ctx.arc(x, y, radius * scale, 0, Math.PI * 2)
    this.ctx.fillStyle = gradient
    this.ctx.fill()

    this.ctx.restore()
  }

  private renderParticles(): void {
    for (const particle of this.particles) {
      const alpha = 1 - particle.life / particle.maxLife
      
      this.ctx.beginPath()
      this.ctx.arc(particle.x, particle.y, particle.diameter, 0, Math.PI * 2)
      this.ctx.fillStyle = this.adjustColor(particle.color, 1, alpha)
      this.ctx.fill()
    }
  }

  private renderRipples(): void {
    for (const ripple of this.ripples) {
      const progress = ripple.progress
      const radius = 80 * progress
      const alpha = 0.6 * (1 - progress)

      for (let i = 0; i < 5; i++) {
        const ringRadius = radius + i * 8
        const ringAlpha = alpha * (1 - i * 0.15)
        
        this.ctx.beginPath()
        this.ctx.arc(ripple.x, ripple.y, ringRadius, 0, Math.PI * 2)
        this.ctx.strokeStyle = this.adjustColor(ripple.color, 1.3, ringAlpha)
        this.ctx.lineWidth = 2
        this.ctx.stroke()
      }
    }
  }

  private renderCards(): void {
    for (const card of this.cards) {
      const scale = this.easeOutBack(card.progress)
      if (scale <= 0) continue

      const ctx = this.ctx
      const maxWidth = 300
      const padding = 16
      const lineHeight = 1.8 * 14
      const fontSize = 14

      ctx.save()
      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
      
      const words = card.sentence.split('')
      let line = ''
      let lines: string[] = []

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n]
        const metrics = ctx.measureText(testLine)
        if (metrics.width > maxWidth - padding * 2 && n > 0) {
          lines.push(line)
          line = words[n]
        } else {
          line = testLine
        }
      }
      lines.push(line)

      const cardWidth = Math.min(maxWidth, ctx.measureText(card.sentence).width + padding * 2)
      const cardHeight = lines.length * lineHeight + padding * 2
      const cardX = card.x - cardWidth / 2
      const cardY = card.y - cardHeight / 2 - 60

      ctx.translate(card.x, card.y - 60)
      ctx.scale(scale, scale)
      ctx.translate(-card.x, -(card.y - 60))

      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
      ctx.shadowBlur = 20
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 4

      ctx.beginPath()
      ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 16)
      ctx.fillStyle = 'rgba(30, 27, 75, 0.9)'
      ctx.fill()

      ctx.shadowColor = 'transparent'

      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'top'

      for (let i = 0; i < lines.length; i++) {
        const lineY = cardY + padding + i * lineHeight
        ctx.fillText(lines[i], cardX + padding, lineY)
      }

      ctx.restore()
    }
  }

  private adjustColor(hex: string, brightness: number = 1, alpha: number = 1): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return hex

    const r = Math.min(255, Math.round(parseInt(result[1], 16) * brightness))
    const g = Math.min(255, Math.round(parseInt(result[2], 16) * brightness))
    const b = Math.min(255, Math.round(parseInt(result[3], 16) * brightness))

    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  private elasticOut(t: number): number {
    const c4 = (2 * Math.PI) / 3
    return t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  }

  private easeOutBack(t: number): number {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  }

  resize(width: number, height: number): void {
    this.canvas.width = width
    this.canvas.height = height
    this.stars = []
    this.initStars()
  }
}
