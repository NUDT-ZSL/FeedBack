import { eventBus, BubbleData, ParticleData, RippleData, CardData } from './eventBus'

const generateId = (): string => Math.random().toString(36).substr(2, 9)

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : { r: 255, g: 255, b: 255 }
}

const rgbToHex = (r: number, g: number, b: number): string => {
  return (
    '#' +
    [r, g, b]
      .map(x => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16)
        return hex.length === 1 ? '0' + hex : hex
      })
      .join('')
  )
}

const mixColors = (color1: string, color2: string, ratio: number = 0.5): string => {
  const c1 = hexToRgb(color1)
  const c2 = hexToRgb(color2)
  return rgbToHex(lerp(c1.r, c2.r, ratio), lerp(c1.g, c2.g, ratio), lerp(c1.b, c2.b, ratio))
}

const getColorFromScore = (score: number): string => {
  const t = (score + 1) / 2
  const coolColor = { r: 110, g: 231, b: 183 }
  const warmColor = { r: 252, g: 165, b: 165 }
  return rgbToHex(
    lerp(coolColor.r, warmColor.r, t),
    lerp(coolColor.g, warmColor.g, t),
    lerp(coolColor.b, warmColor.b, t)
  )
}

interface Star {
  x: number
  y: number
  size: number
  baseBrightness: number
  phase: number
  period: number
}

export class BubblePhysics {
  private bubbles: Map<string, BubbleData> = new Map()
  private particles: Map<string, ParticleData> = new Map()
  private ripples: Map<string, RippleData> = new Map()
  private cards: Map<string, CardData> = new Map()
  private stars: Star[] = []
  private canvasWidth: number
  private canvasHeight: number

  constructor(width: number, height: number) {
    this.canvasWidth = width
    this.canvasHeight = height
    this.initStars()
    this.setupEventListeners()
  }

  private initStars(): void {
    const starCount = Math.floor((this.canvasWidth * this.canvasHeight) / 8000)
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * this.canvasWidth,
        y: Math.random() * this.canvasHeight,
        size: 1 + Math.random() * 2,
        baseBrightness: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        period: 2 + Math.random() * 2
      })
    }
  }

  private setupEventListeners(): void {
    eventBus.on('analyzed', this.handleAnalyzed.bind(this))
    eventBus.on('click', this.handleClick.bind(this))
    eventBus.on('clear', this.handleClear.bind(this))
  }

  private handleAnalyzed(data: {
    sentences: Array<{ sentence: string; score: number; keywords: string[] }>
    originX: number
    originY: number
  }): void {
    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2

    data.sentences.forEach((analysis) => {
      const id = generateId()
      const offsetX = (Math.random() - 0.5) * 400
      const offsetY = (Math.random() - 0.5) * 400

      const targetX = centerX + offsetX
      const targetY = centerY + offsetY

      const diameter = 40 + Math.abs(analysis.score) * 60
      const color = getColorFromScore(analysis.score)

      const bubble: BubbleData = {
        id,
        x: data.originX,
        y: data.originY,
        vx: (targetX - data.originX) / 500,
        vy: (targetY - data.originY) / 500,
        diameter,
        color,
        score: analysis.score,
        sentence: analysis.sentence,
        keywords: analysis.keywords,
        life: 100,
        spawnProgress: 0,
        isPopping: false,
        popProgress: 0,
        isExpanded: false
      }

      this.bubbles.set(id, bubble)

      setTimeout(() => {
        if (this.bubbles.has(id)) {
          const b = this.bubbles.get(id)!
          b.vx = (Math.random() - 0.5) * 0.5
          b.vy = -0.3
        }
      }, 500)
    })

    this.updateInfoPanel()
  }

  private handleClick(data: { bubbleId: string }): void {
    const bubble = this.bubbles.get(data.bubbleId)
    if (!bubble) return

    if (bubble.isExpanded) {
      this.startPopAnimation(bubble)
    } else {
      this.expandBubble(bubble)
    }
  }

  private expandBubble(bubble: BubbleData): void {
    bubble.isExpanded = true

    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (this.bubbles.has(bubble.id)) {
          const ripple: RippleData = {
            id: generateId(),
            x: bubble.x,
            y: bubble.y,
            color: bubble.color,
            progress: 0
          }
          this.ripples.set(ripple.id, ripple)
        }
      }, i * 80)
    }

    const card: CardData = {
      id: generateId(),
      bubbleId: bubble.id,
      x: bubble.x,
      y: bubble.y,
      sentence: bubble.sentence,
      progress: 0
    }
    this.cards.set(card.id, card)
  }

  private startPopAnimation(bubble: BubbleData): void {
    bubble.isPopping = true
    bubble.popProgress = 0

    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20 + Math.random() * 0.3
      const speed = 1 + Math.random() * 2
      const particle: ParticleData = {
        id: generateId(),
        x: bubble.x,
        y: bubble.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: bubble.color,
        diameter: Math.max(2, bubble.diameter / 10 + Math.random() * 2),
        life: 0,
        maxLife: 0.4
      }
      this.particles.set(particle.id, particle)
    }

    for (const [cardId, card] of this.cards) {
      if (card.bubbleId === bubble.id) {
        this.cards.delete(cardId)
      }
    }
  }

  private handleClear(): void {
    this.bubbles.forEach(bubble => {
      bubble.isPopping = true
      bubble.popProgress = 0
    })
    setTimeout(() => {
      this.bubbles.clear()
      this.cards.clear()
      this.updateInfoPanel()
    }, 400)
  }

  update(deltaTime: number): void {
    const dt = deltaTime / 16.67

    for (const star of this.stars) {
      star.phase += (deltaTime / 1000) * (1 / star.period) * Math.PI * 2
    }

    for (const [id, bubble] of this.bubbles) {
      if (bubble.spawnProgress < 1) {
        bubble.spawnProgress = Math.min(1, bubble.spawnProgress + deltaTime / 500)
        const easeOut = 1 - Math.pow(1 - bubble.spawnProgress, 3)
        bubble.x += (bubble.vx * dt) * easeOut
        bubble.y += (bubble.vy * dt) * easeOut
      } else if (bubble.isPopping) {
        bubble.popProgress += deltaTime / 400
        if (bubble.popProgress >= 1) {
          this.bubbles.delete(id)
          this.updateInfoPanel()
        }
      } else {
        bubble.vx += (Math.random() - 0.5) * 0.01 * dt
        bubble.vy += (Math.random() - 0.5) * 0.01 * dt
        bubble.vy -= 0.003 * dt

        bubble.vx = Math.max(-2, Math.min(2, bubble.vx))
        bubble.vy = Math.max(-2, Math.min(2, bubble.vy))

        bubble.x += bubble.vx * dt
        bubble.y += bubble.vy * dt

        const radius = bubble.diameter / 2
        if (bubble.x < radius) {
          bubble.x = radius
          bubble.vx *= -0.8
        }
        if (bubble.x > this.canvasWidth - radius) {
          bubble.x = this.canvasWidth - radius
          bubble.vx *= -0.8
        }
        if (bubble.y < radius) {
          bubble.y = radius
          bubble.vy *= -0.8
        }
        if (bubble.y > this.canvasHeight - radius) {
          bubble.y = this.canvasHeight - radius
          bubble.vy *= -0.8
        }
      }
    }

    this.handleCollisions()

    for (const [id, particle] of this.particles) {
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.vy += 0.05 * dt
      particle.life += deltaTime / 1000
      if (particle.life >= particle.maxLife) {
        this.particles.delete(id)
      }
    }

    for (const [id, ripple] of this.ripples) {
      ripple.progress += deltaTime / 600
      if (ripple.progress >= 1) {
        this.ripples.delete(id)
      }
    }

    for (const [, card] of this.cards) {
      if (card.progress < 1) {
        card.progress = Math.min(1, card.progress + deltaTime / 300)
      }
      const bubble = this.bubbles.get(card.bubbleId)
      if (bubble) {
        card.x = bubble.x
        card.y = bubble.y
      }
    }

    eventBus.emit('update', {
      bubbles: Array.from(this.bubbles.values()),
      particles: Array.from(this.particles.values()),
      ripples: Array.from(this.ripples.values()),
      cards: Array.from(this.cards.values())
    })
  }

  private handleCollisions(): void {
    const bubbleArray = Array.from(this.bubbles.values()).filter(
      b => b.spawnProgress >= 1 && !b.isPopping
    )

    for (let i = 0; i < bubbleArray.length; i++) {
      for (let j = i + 1; j < bubbleArray.length; j++) {
        const b1 = bubbleArray[i]
        const b2 = bubbleArray[j]

        const dx = b2.x - b1.x
        const dy = b2.y - b1.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const minDist = (b1.diameter + b2.diameter) / 2

        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist
          const nx = dx / dist
          const ny = dy / dist

          const mass1 = b1.diameter
          const mass2 = b2.diameter
          const totalMass = mass1 + mass2

          b1.x -= nx * overlap * (mass2 / totalMass)
          b1.y -= ny * overlap * (mass2 / totalMass)
          b2.x += nx * overlap * (mass1 / totalMass)
          b2.y += ny * overlap * (mass1 / totalMass)

          const dvx = b1.vx - b2.vx
          const dvy = b1.vy - b2.vy
          const dvDotN = dvx * nx + dvy * ny

          if (dvDotN > 0) {
            const restitution = 0.8
            const impulse = (2 * dvDotN) / totalMass

            b1.vx -= impulse * mass2 * nx * restitution
            b1.vy -= impulse * mass2 * ny * restitution
            b2.vx += impulse * mass1 * nx * restitution
            b2.vy += impulse * mass1 * ny * restitution

            this.createCollisionParticles(b1, b2, (b1.x + b2.x) / 2, (b1.y + b2.y) / 2)
          }
        }
      }
    }
  }

  private createCollisionParticles(b1: BubbleData, b2: BubbleData, x: number, y: number): void {
    const mixedColor = mixColors(b1.color, b2.color)
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 2
      const particle: ParticleData = {
        id: generateId(),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: mixedColor,
        diameter: 2 + Math.random() * 2,
        life: 0,
        maxLife: 1.5
      }
      this.particles.set(particle.id, particle)
    }
  }

  getBubbles(): BubbleData[] {
    return Array.from(this.bubbles.values())
  }

  getStars(): Star[] {
    return this.stars
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width
    this.canvasHeight = height
    this.stars = []
    this.initStars()
  }

  private updateInfoPanel(): void {
    const bubbleCount = document.getElementById('bubbleCount')
    const sentenceList = document.getElementById('sentenceList')

    if (bubbleCount) {
      bubbleCount.textContent = this.bubbles.size.toString()
    }

    if (sentenceList) {
      const activeBubbles = Array.from(this.bubbles.values()).filter(b => !b.isPopping)
      if (activeBubbles.length === 0) {
        sentenceList.innerHTML = '<div class="empty-tip">还没有气泡~</div>'
      } else {
        sentenceList.innerHTML = activeBubbles
          .map(
            b =>
              `<div class="sentence-item" data-id="${b.id}" title="${b.sentence}">${b.sentence}</div>`
          )
          .join('')

        sentenceList.querySelectorAll('.sentence-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = item.getAttribute('data-id')
            if (id) {
              this.focusBubble(id)
            }
          })
        })
      }
    }
  }

  private focusBubble(bubbleId: string): void {
    const bubble = this.bubbles.get(bubbleId)
    if (!bubble) return

    const centerX = this.canvasWidth / 2
    const centerY = this.canvasHeight / 2
    const offsetX = centerX - bubble.x
    const offsetY = centerY - bubble.y

    const duration = 500
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(1, elapsed / duration)
      const easeProgress = 1 - Math.pow(1 - progress, 3)

      this.bubbles.forEach(b => {
        if (!b.isPopping) {
          b.x += offsetX * 0.05 * easeProgress
          b.y += offsetY * 0.05 * easeProgress
        }
      })

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }
}
