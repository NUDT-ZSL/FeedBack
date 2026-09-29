import type { RafScheduler } from '../../src/core/renderLoop'

export class FakeAudioNode {
  connectCount = 0
  disconnectCount = 0
  connect(): this {
    this.connectCount += 1
    return this
  }
  disconnect(): void {
    this.disconnectCount += 1
  }
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 1024
  smoothingTimeConstant = 0
  timeDomainFill = 140
  frequencyFill = 200
  get frequencyBinCount(): number {
    return this.fftSize / 2
  }
  getByteFrequencyData(arr: Uint8Array): void {
    arr.fill(this.frequencyFill)
  }
  getByteTimeDomainData(arr: Uint8Array): void {
    arr.fill(this.timeDomainFill)
  }
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  destination = new FakeAudioNode()
  analysers: FakeAnalyserNode[] = []
  sources: FakeAudioNode[] = []
  splitters: FakeAudioNode[] = []
  resumeCount = 0
  closeCount = 0

  createAnalyser(): FakeAnalyserNode {
    const node = new FakeAnalyserNode()
    this.analysers.push(node)
    return node
  }
  createMediaElementSource(_element: unknown): FakeAudioNode {
    const node = new FakeAudioNode()
    this.sources.push(node)
    return node
  }
  createChannelSplitter(_channels = 2): FakeAudioNode {
    const node = new FakeAudioNode()
    this.splitters.push(node)
    return node
  }
  async resume(): Promise<void> {
    this.resumeCount += 1
    this.state = 'running'
  }
  async close(): Promise<void> {
    this.closeCount += 1
    this.state = 'closed'
  }
}

export function createContextFactoryRegistry() {
  const contexts: FakeAudioContext[] = []
  const factory = (): AudioContext => {
    const ctx = new FakeAudioContext()
    contexts.push(ctx)
    return ctx as unknown as AudioContext
  }
  return { contexts, factory }
}

export class FakeAudioElement {
  src = ''
  currentTime = 0
  duration = 0
  volume = 1
  paused = true
  playCount = 0
  pauseCount = 0
  private listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn)
  }
  emit(type: string): void {
    this.listeners.get(type)?.forEach((fn) => fn())
  }
  async play(): Promise<void> {
    this.playCount += 1
    this.paused = false
    this.emit('play')
  }
  pause(): void {
    this.pauseCount += 1
    this.paused = true
    this.emit('pause')
  }
}

export function createManualScheduler() {
  let nextId = 1
  const pending = new Map<number, (time: number) => void>()
  const scheduler: RafScheduler = {
    request: (cb) => {
      const id = nextId++
      pending.set(id, cb)
      return id
    },
    cancel: (id) => {
      pending.delete(id)
    },
  }
  return {
    scheduler,
    step(time = 0): void {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((cb) => cb(time))
    },
    get pendingCount(): number {
      return pending.size
    },
  }
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D
  points: Array<[number, number]>
  rects: Array<[number, number, number, number]>
}

export function createRecordingContext(): RecordingContext {
  const points: Array<[number, number]> = []
  const rects: Array<[number, number, number, number]> = []
  const ctx = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    beginPath() {},
    stroke() {},
    moveTo(x: number, y: number) {
      points.push([x, y])
    },
    lineTo(x: number, y: number) {
      points.push([x, y])
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push([x, y, w, h])
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, points, rects }
}

export function createFakeCanvas(cssWidth: number, cssHeight: number) {
  const recording = createRecordingContext()
  const rect = { width: cssWidth, height: cssHeight }
  const canvas = {
    width: 300,
    height: 150,
    getContext: () => recording.ctx,
    getBoundingClientRect: () => rect,
  }
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    rect,
    recording,
  }
}

export function fakeFile(name: string): Blob & { name: string } {
  return { name } as Blob & { name: string }
}
