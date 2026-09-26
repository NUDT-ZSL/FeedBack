export interface InputEvent {
  text: string
  originX: number
  originY: number
}

export interface SentenceAnalysis {
  sentence: string
  score: number
  keywords: string[]
}

export interface AnalyzedEvent {
  sentences: SentenceAnalysis[]
  originX: number
  originY: number
}

export interface BubbleData {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  diameter: number
  color: string
  score: number
  sentence: string
  keywords: string[]
  life: number
  spawnProgress: number
  isPopping: boolean
  popProgress: number
  isExpanded: boolean
}

export interface UpdateEvent {
  bubbles: BubbleData[]
  particles: ParticleData[]
  ripples: RippleData[]
  cards: CardData[]
}

export interface ClickEvent {
  bubbleId: string
}

export interface ParticleData {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  diameter: number
  life: number
  maxLife: number
}

export interface RippleData {
  id: string
  x: number
  y: number
  color: string
  progress: number
}

export interface CardData {
  id: string
  bubbleId: string
  x: number
  y: number
  sentence: string
  progress: number
}

type EventType = 'input' | 'analyzed' | 'update' | 'click' | 'clear'

type EventDataMap = {
  input: InputEvent
  analyzed: AnalyzedEvent
  update: UpdateEvent
  click: ClickEvent
  clear: void
}

type Callback<T extends EventType> = (data: EventDataMap[T]) => void

class EventBus {
  private listeners: Map<EventType, Set<Callback<EventType>>> = new Map()

  on<T extends EventType>(event: T, callback: Callback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback as Callback<EventType>)
  }

  off<T extends EventType>(event: T, callback: Callback<T>): void {
    this.listeners.get(event)?.delete(callback as Callback<EventType>)
  }

  emit<T extends EventType>(event: T, data: EventDataMap[T]): void {
    this.listeners.get(event)?.forEach(callback => callback(data))
  }
}

export const eventBus = new EventBus()
