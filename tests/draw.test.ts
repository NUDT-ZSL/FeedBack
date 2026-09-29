import { describe, expect, it } from 'vitest'
import { drawScene, type VizMode } from '../src/core/draw'
import { createRecordingContext, type RecordingContext } from './helpers/fakes'

const analyzer = {
  getTimeDomainData: () => {
    const data = new Uint8Array(2048)
    for (let i = 0; i < data.length; i++) data[i] = i % 256
    return data
  },
  getFrequencyData: () => new Uint8Array(1024).fill(255),
}

function expectWithinBounds(recording: RecordingContext, width: number, height: number) {
  const eps = 1e-6
  for (const [x, y] of recording.points) {
    expect(Number.isFinite(x)).toBe(true)
    expect(Number.isFinite(y)).toBe(true)
    expect(x).toBeGreaterThanOrEqual(-eps)
    expect(x).toBeLessThanOrEqual(width + eps)
    expect(y).toBeGreaterThanOrEqual(-eps)
    expect(y).toBeLessThanOrEqual(height + eps)
  }
  for (const [x, y, w, h] of recording.rects) {
    expect(x).toBeGreaterThanOrEqual(-eps)
    expect(y).toBeGreaterThanOrEqual(-eps)
    expect(x + w).toBeLessThanOrEqual(width + eps)
    expect(y + h).toBeLessThanOrEqual(height + eps)
  }
}

describe('drawScene coordinate bounds', () => {
  const sizes = [
    { width: 800, height: 400 },
    { width: 320, height: 160 },
    { width: 173, height: 91 },
    { width: 1, height: 1 },
  ]
  const modes: VizMode[] = ['waveform', 'spectrum']

  for (const { width, height } of sizes) {
    for (const mode of modes) {
      it(`keeps ${mode} coordinates inside ${width}x${height}`, () => {
        const recording = createRecordingContext()
        drawScene(recording.ctx, {
          analyzer,
          isPlaying: true,
          isSeeking: false,
          mode,
          width,
          height,
        })
        expectWithinBounds(recording, width, height)
      })
    }
  }

  it('draws only the idle line when paused or seeking', () => {
    for (const [isPlaying, isSeeking] of [
      [false, false],
      [true, true],
    ] as const) {
      const recording = createRecordingContext()
      drawScene(recording.ctx, {
        analyzer,
        isPlaying,
        isSeeking,
        mode: 'waveform',
        width: 800,
        height: 400,
      })
      // background rect + idle line endpoints only
      expect(recording.rects).toEqual([[0, 0, 800, 400]])
      expect(recording.points).toEqual([
        [0, 200],
        [800, 200],
      ])
    }
  })
})
