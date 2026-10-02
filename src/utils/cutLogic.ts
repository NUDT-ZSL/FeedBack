export interface Point {
  x: number
  y: number
}

export interface CutPath {
  points: Point[]
  timestamp: number
}

export interface Template {
  id: string
  name: string
  svgPath: string
  area: number
  thumbnail: string
}

export const PAPER_SIZE = 400

const MAX_UNDO_STACK = 10

export class CutLogic {
  private currentPath: Point[] = []
  private cutPaths: CutPath[] = []
  private undoStack: CutPath[][] = []
  private isDrawing: boolean = false
  private template: Template | null = null
  private templateMask: ImageData | null = null
  private cutMask: boolean[][] = []
  private completionCallback: ((progress: number, completed: boolean) => void) | null = null
  private completionThreshold: number = 0.75
  private isCompleted: boolean = false

  constructor() {
    this.initCutMask()
  }

  private initCutMask(): void {
    this.cutMask = Array(PAPER_SIZE).fill(null).map(() => Array(PAPER_SIZE).fill(false))
  }

  setTemplate(template: Template): void {
    this.template = template
    this.isCompleted = false
  }

  setTemplateMask(imageData: ImageData): void {
    this.templateMask = imageData
  }

  setCompletionCallback(callback: (progress: number, completed: boolean) => void): void {
    this.completionCallback = callback
  }

  startDrawing(point: Point): void {
    if (this.isCompleted) return
    this.isDrawing = true
    this.currentPath = [point]
    this.saveUndoState()
  }

  continueDrawing(point: Point): void {
    if (!this.isDrawing || this.isCompleted) return
    const lastPoint = this.currentPath[this.currentPath.length - 1]
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y)
    if (distance > 1) {
      this.currentPath.push(point)
      this.markCutArea(lastPoint, point)
    }
  }

  endDrawing(): CutPath | null {
    if (!this.isDrawing || this.currentPath.length < 2) {
      this.isDrawing = false
      this.currentPath = []
      return null
    }
    this.isDrawing = false
    const cutPath: CutPath = {
      points: [...this.currentPath],
      timestamp: Date.now()
    }
    this.cutPaths.push(cutPath)
    this.currentPath = []
    this.calculateCompletion()
    return cutPath
  }

  private saveUndoState(): void {
    const state = JSON.parse(JSON.stringify(this.cutPaths))
    this.undoStack.push(state)
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift()
    }
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false
    const previousState = this.undoStack.pop()!
    this.cutPaths = previousState
    this.rebuildCutMask()
    this.isCompleted = false
    this.calculateCompletion()
    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  private markCutArea(p1: Point, p2: Point): void {
    const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y))
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = Math.floor(p1.x + (p2.x - p1.x) * t)
      const y = Math.floor(p1.y + (p2.y - p1.y) * t)
      this.markPoint(x, y)
    }
  }

  private markPoint(cx: number, cy: number): void {
    const radius = 3
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < PAPER_SIZE && y >= 0 && y < PAPER_SIZE) {
          if (dx * dx + dy * dy <= radius * radius) {
            this.cutMask[y][x] = true
          }
        }
      }
    }
  }

  private rebuildCutMask(): void {
    this.initCutMask()
    for (const path of this.cutPaths) {
      for (let i = 1; i < path.points.length; i++) {
        this.markCutArea(path.points[i - 1], path.points[i])
      }
    }
  }

  calculateCompletion(): number {
    if (!this.templateMask) return 0
    const data = this.templateMask.data
    let totalTemplatePixels = 0
    let cutTemplatePixels = 0
    for (let y = 0; y < PAPER_SIZE; y++) {
      for (let x = 0; x < PAPER_SIZE; x++) {
        const idx = (y * PAPER_SIZE + x) * 4
        const alpha = data[idx + 3]
        if (alpha > 50) {
          totalTemplatePixels++
          if (this.cutMask[y][x]) {
            cutTemplatePixels++
          }
        }
      }
    }
    const progress = totalTemplatePixels > 0 ? cutTemplatePixels / totalTemplatePixels : 0
    const completed = progress >= this.completionThreshold && !this.isCompleted
    if (completed) {
      this.isCompleted = true
    }
    if (this.completionCallback) {
      this.completionCallback(progress, completed)
    }
    return progress
  }

  getCutPaths(): CutPath[] {
    return [...this.cutPaths]
  }

  getCurrentPath(): Point[] {
    return [...this.currentPath]
  }

  reset(): void {
    this.currentPath = []
    this.cutPaths = []
    this.undoStack = []
    this.isDrawing = false
    this.isCompleted = false
    this.initCutMask()
  }

  getCompleted(): boolean {
    return this.isCompleted
  }
}

export const templates: Template[] = [
  {
    id: 'peony',
    name: '富贵牡丹',
    area: 12000,
    thumbnail: 'peony',
    svgPath: `
      <circle cx="200" cy="200" r="60" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="200" cy="200" r="40" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="200" cy="120" rx="25" ry="35" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="280" cy="160" rx="35" ry="25" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="280" cy="240" rx="35" ry="25" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="200" cy="280" rx="25" ry="35" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="120" cy="240" rx="35" ry="25" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="120" cy="160" rx="35" ry="25" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 80 Q210 60 200 40 Q190 60 200 80" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M260 110 Q290 100 300 70" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M290 200 Q320 190 340 210" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M260 290 Q290 310 300 340" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 320 Q190 350 200 370 Q210 350 200 320" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M140 290 Q110 310 100 340" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M110 200 Q80 190 60 210" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M140 110 Q110 100 100 70" fill="none" stroke="#888" stroke-width="2"/>
    `
  },
  {
    id: 'magpie',
    name: '喜鹊登梅',
    area: 11500,
    thumbnail: 'magpie',
    svgPath: `
      <path d="M200 350 L200 150" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M200 280 Q150 260 120 280" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 220 Q250 200 280 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 180 Q160 160 130 140" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="120" cy="280" r="8" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="280" cy="220" r="8" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="130" cy="140" r="8" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="230" cy="120" rx="25" ry="20" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="240" cy="115" r="3" fill="#888"/>
      <path d="M255 120 L270 115 L255 125 Z" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M220 135 Q200 150 180 145" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M235 140 Q250 160 240 180" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M100 300 Q80 320 90 350" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="90" cy="350" r="6" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M300 180 Q320 160 330 130" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="330" cy="130" r="6" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 350 Q220 370 200 390 Q180 370 200 350" fill="none" stroke="#888" stroke-width="2"/>
    `
  },
  {
    id: 'fu',
    name: '福字团圆',
    area: 13000,
    thumbnail: 'fu',
    svgPath: `
      <circle cx="200" cy="200" r="180" fill="none" stroke="#888" stroke-width="3"/>
      <circle cx="200" cy="200" r="150" fill="none" stroke="#888" stroke-width="2"/>
      <rect x="120" y="120" width="160" height="160" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M160 150 L240 150 M200 150 L200 250" fill="none" stroke="#888" stroke-width="4"/>
      <path d="M150 180 Q180 170 200 180 Q220 170 250 180" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M160 210 L240 210" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M170 240 Q200 260 230 240" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M140 100 Q150 80 160 100" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M240 100 Q250 80 260 100" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M100 200 Q80 210 100 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M300 200 Q320 210 300 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M140 300 Q150 320 160 300" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M240 300 Q250 320 260 300" fill="none" stroke="#888" stroke-width="2"/>
    `
  },
  {
    id: 'fish',
    name: '鱼跃龙门',
    area: 12500,
    thumbnail: 'fish',
    svgPath: `
      <path d="M200 320 Q150 280 130 220 Q150 160 200 140 Q250 160 270 220 Q250 280 200 320" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 140 Q170 100 140 80 M200 140 Q230 100 260 80" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="185" cy="180" r="6" fill="#888"/>
      <path d="M160 200 Q180 210 160 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M240 200 Q220 210 240 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 230 Q220 250 200 270 Q180 250 200 230" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 320 L180 350 L200 340 L220 350 Z" fill="none" stroke="#888" stroke-width="2"/>
      <rect x="60" y="40" width="280" height="20" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M60 40 Q40 60 60 80" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M340 40 Q360 60 340 80" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M80 80 Q100 100 80 120" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M320 80 Q300 100 320 120" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="200" cy="60" r="5" fill="#888"/>
      <circle cx="150" cy="60" r="3" fill="#888"/>
      <circle cx="250" cy="60" r="3" fill="#888"/>
      <path d="M200 340 Q210 360 200 380 Q190 360 200 340" fill="none" stroke="#888" stroke-width="2"/>
    `
  },
  {
    id: 'dragons',
    name: '二龙戏珠',
    area: 14000,
    thumbnail: 'dragons',
    svgPath: `
      <circle cx="200" cy="200" r="30" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="200" cy="200" r="15" fill="#888"/>
      <path d="M200 200 Q150 150 100 120 Q80 150 90 180 Q120 200 100 220 Q80 250 100 280 Q150 250 200 200" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 200 Q250 150 300 120 Q320 150 310 180 Q280 200 300 220 Q320 250 300 280 Q250 250 200 200" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="95" cy="135" rx="15" ry="12" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="305" cy="135" rx="15" ry="12" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="90" cy="135" r="3" fill="#888"/>
      <circle cx="310" cy="135" r="3" fill="#888"/>
      <path d="M85 150 L75 160 M85 155 L70 155 M85 160 L75 150" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M315 150 L325 160 M315 155 L330 155 M315 160 L325 150" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M90 180 Q70 200 80 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M310 180 Q330 200 320 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M100 280 Q90 310 110 330" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M300 280 Q310 310 290 330" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="200" cy="200" r="5" fill="#fff"/>
      <path d="M200 80 Q210 60 200 40 Q190 60 200 80" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 320 Q210 340 200 360 Q190 340 200 320" fill="none" stroke="#888" stroke-width="2"/>
    `
  },
  {
    id: 'lotus',
    name: '连年有余',
    area: 13500,
    thumbnail: 'lotus',
    svgPath: `
      <ellipse cx="200" cy="280" rx="80" ry="30" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 250 Q160 200 180 150" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 250 Q240 200 220 150" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 250 L200 180" fill="none" stroke="#888" stroke-width="3"/>
      <path d="M180 150 Q200 120 220 150 Q200 130 180 150" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M160 170 Q140 150 130 170 Q150 160 160 170" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M240 170 Q260 150 270 170 Q250 160 240 170" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="130" cy="230" rx="25" ry="15" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="270" cy="230" rx="25" ry="15" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M155 230 L180 230" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M220 230 L245 230" fill="none" stroke="#888" stroke-width="2"/>
      <ellipse cx="200" cy="210" rx="18" ry="10" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M190 210 L190 190 M210 210 L210 190" fill="none" stroke="#888" stroke-width="2"/>
      <circle cx="110" cy="300" r="8" fill="#888"/>
      <circle cx="290" cy="300" r="8" fill="#888"/>
      <path d="M200 80 Q210 60 200 40 Q190 60 200 80" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M200 320 Q210 340 200 360 Q190 340 200 320" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M80 200 Q60 210 80 220" fill="none" stroke="#888" stroke-width="2"/>
      <path d="M320 200 Q340 210 320 220" fill="none" stroke="#888" stroke-width="2"/>
    `
  }
]

export function generateTemplateThumbnail(template: Template): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100" height="100">
      ${template.svgPath}
    </svg>
  `
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}
