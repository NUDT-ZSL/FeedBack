import { describe, expect, it } from 'vitest'
import { RenderLoop } from '../src/core/renderLoop'
import { createManualScheduler } from './helpers/fakes'

describe('RenderLoop', () => {
  it('starts and stops idempotently with exact counts', () => {
    const { scheduler, step } = createManualScheduler()
    const frames: number[] = []
    const loop = new RenderLoop((t) => frames.push(t), scheduler)

    loop.start()
    loop.start()
    loop.start()
    expect(loop.startCount).toBe(1)
    expect(loop.isRunning).toBe(true)

    step(16)
    step(32)
    step(48)
    expect(loop.frameCount).toBe(3)
    expect(frames).toEqual([16, 32, 48])

    loop.stop()
    loop.stop()
    expect(loop.stopCount).toBe(1)
    expect(loop.isRunning).toBe(false)

    step(64)
    expect(loop.frameCount).toBe(3)
  })

  it('can be restarted after a stop', () => {
    const { scheduler, step } = createManualScheduler()
    const loop = new RenderLoop(() => undefined, scheduler)

    loop.start()
    step(16)
    loop.stop()
    loop.start()
    step(32)

    expect(loop.startCount).toBe(2)
    expect(loop.stopCount).toBe(1)
    expect(loop.frameCount).toBe(2)
  })
})
