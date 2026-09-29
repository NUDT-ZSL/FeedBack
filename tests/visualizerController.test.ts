import { describe, expect, it } from 'vitest'
import { AudioEngine } from '../src/core/audioEngine'
import type { VizMode } from '../src/core/draw'
import { VisualizerController } from '../src/core/visualizerController'
import {
  FakeAudioElement,
  createContextFactoryRegistry,
  createFakeCanvas,
  createManualScheduler,
  fakeFile,
} from './helpers/fakes'

function setup(dpr = 1) {
  const { contexts, factory } = createContextFactoryRegistry()
  const engine = new AudioEngine({
    contextFactory: factory,
    createObjectUrl: () => 'blob:fake',
    revokeObjectUrl: () => undefined,
  })
  const audio = new FakeAudioElement()
  engine.attachElement(audio as unknown as HTMLAudioElement)

  const { scheduler, step } = createManualScheduler()
  let mode: VizMode = 'waveform'
  const controller = new VisualizerController(engine, () => mode, {
    scheduler,
    devicePixelRatio: () => dpr,
  })
  const fakeCanvas = createFakeCanvas(800, 400)
  controller.attach(fakeCanvas.canvas)

  return {
    engine,
    audio,
    controller,
    step,
    contexts,
    ...fakeCanvas,
    setMode: (m: VizMode) => {
      mode = m
    },
  }
}

describe('VisualizerController render loop', () => {
  it('runs one continuous loop across play, pause, seek and mode switches', async () => {
    const s = setup()

    await s.engine.loadFile(fakeFile('a.mp3'))
    await s.engine.togglePlay() // pause
    await s.engine.togglePlay() // play
    s.engine.beginSeek()
    s.engine.previewSeek(10)
    s.engine.endSeek(10)
    s.setMode('spectrum')
    s.setMode('waveform')
    s.setMode('spectrum')

    s.step(16)
    s.step(32)

    expect(s.controller.loop.startCount).toBe(1)
    expect(s.controller.loop.stopCount).toBe(0)
    expect(s.controller.loop.frameCount).toBe(2)

    s.controller.detach()
    expect(s.controller.loop.stopCount).toBe(1)
    s.step(48)
    expect(s.controller.loop.frameCount).toBe(2)
  })

  it('re-uploading a file does not rebuild the loop', async () => {
    const s = setup()

    await s.engine.loadFile(fakeFile('a.mp3'))
    await s.engine.loadFile(fakeFile('b.mp3'))
    s.step(16)

    expect(s.controller.loop.startCount).toBe(1)
    expect(s.controller.loop.stopCount).toBe(0)
    expect(s.engine.analyzers.activeCount).toBe(1)
  })
})

describe('VisualizerController canvas sizing', () => {
  it('maps CSS size to backing store with device pixel ratio', () => {
    const s = setup(2)
    expect(s.canvas.width).toBe(1600)
    expect(s.canvas.height).toBe(800)
    expect(s.controller.size).toEqual({ width: 1600, height: 800 })
  })

  it('keeps drawing coordinates in bounds after a resize', async () => {
    const s = setup()
    await s.engine.loadFile(fakeFile('a.mp3'))

    const checkBounds = (width: number, height: number) => {
      const eps = 1e-6
      for (const [x, y] of s.recording.points) {
        expect(x).toBeGreaterThanOrEqual(-eps)
        expect(x).toBeLessThanOrEqual(width + eps)
        expect(y).toBeGreaterThanOrEqual(-eps)
        expect(y).toBeLessThanOrEqual(height + eps)
      }
      for (const [x, y, w, h] of s.recording.rects) {
        expect(x).toBeGreaterThanOrEqual(-eps)
        expect(y).toBeGreaterThanOrEqual(-eps)
        expect(x + w).toBeLessThanOrEqual(width + eps)
        expect(y + h).toBeLessThanOrEqual(height + eps)
      }
    }

    // Draw at the initial size in both modes.
    s.step(16)
    checkBounds(800, 400)
    s.setMode('spectrum')
    s.step(32)
    checkBounds(800, 400)

    // Simulate a layout change, then redraw: coordinates must follow the
    // new backing-store size instead of being stretched or cropped.
    s.rect.width = 320
    s.rect.height = 160
    s.controller.syncCanvasSize()
    expect(s.canvas.width).toBe(320)
    expect(s.canvas.height).toBe(160)

    s.recording.points.length = 0
    s.recording.rects.length = 0
    s.step(48)
    checkBounds(320, 160)

    s.setMode('waveform')
    s.recording.points.length = 0
    s.recording.rects.length = 0
    s.step(64)
    checkBounds(320, 160)
  })
})
