import { describe, expect, it } from 'vitest'
import { AudioEngine } from '../src/core/audioEngine'
import {
  FakeAudioElement,
  createContextFactoryRegistry,
  fakeFile,
} from './helpers/fakes'

function setup() {
  const { contexts, factory } = createContextFactoryRegistry()
  const revoked: string[] = []
  let urlCounter = 0
  const engine = new AudioEngine({
    contextFactory: factory,
    createObjectUrl: () => `blob:fake-${++urlCounter}`,
    revokeObjectUrl: (url) => {
      revoked.push(url)
    },
  })
  const audio = new FakeAudioElement()
  engine.attachElement(audio as unknown as HTMLAudioElement)
  return { engine, audio, contexts, revoked }
}

describe('AudioEngine analyzer lifecycle', () => {
  it('keeps exactly one active analyzer across multiple uploads', async () => {
    const { engine, contexts } = setup()

    await engine.loadFile(fakeFile('a.mp3'))
    await engine.loadFile(fakeFile('b.mp3'))
    await engine.loadFile(fakeFile('c.mp3'))

    expect(engine.analyzers.activeCount).toBe(1)
    expect(contexts).toHaveLength(1)
    expect(engine.getSnapshot().fileName).toBe('c.mp3')
  })

  it('releases the analyzer when disposed', async () => {
    const { engine, contexts } = setup()

    await engine.loadFile(fakeFile('a.mp3'))
    expect(engine.analyzers.activeCount).toBe(1)

    engine.dispose()
    expect(engine.analyzers.activeCount).toBe(0)
    expect(contexts[0].closeCount).toBe(1)
  })

  it('revokes the previous object URL on each re-upload', async () => {
    const { engine, revoked } = setup()

    await engine.loadFile(fakeFile('a.mp3'))
    await engine.loadFile(fakeFile('b.mp3'))

    expect(revoked).toEqual(['blob:fake-1'])
  })
})

describe('AudioEngine playback state and VU levels', () => {
  it('VU levels are zero unless playing and not seeking', async () => {
    const { engine, audio } = setup()

    expect(engine.getVULevels()).toEqual({ left: 0, right: 0 })

    await engine.loadFile(fakeFile('a.mp3'))
    expect(engine.getSnapshot().isPlaying).toBe(true)
    const playing = engine.getVULevels()
    expect(playing.left).toBeGreaterThan(0)
    expect(playing.right).toBeGreaterThan(0)

    // Pause -> zero
    await engine.togglePlay()
    expect(engine.getSnapshot().isPlaying).toBe(false)
    expect(engine.getVULevels()).toEqual({ left: 0, right: 0 })

    // Resume -> peaks again
    await engine.togglePlay()
    expect(engine.getVULevels().left).toBeGreaterThan(0)

    // Seek drag -> zero while dragging, peaks after release
    engine.beginSeek()
    engine.previewSeek(12)
    expect(engine.getVULevels()).toEqual({ left: 0, right: 0 })
    engine.endSeek(12)
    expect(audio.currentTime).toBe(12)
    expect(engine.getVULevels().left).toBeGreaterThan(0)

    // Stop -> zero
    engine.stop()
    expect(engine.getVULevels()).toEqual({ left: 0, right: 0 })
  })

  it('does not overwrite the dragged position with timeupdate events', async () => {
    const { engine, audio } = setup()
    await engine.loadFile(fakeFile('a.mp3'))

    engine.beginSeek()
    engine.previewSeek(30)
    audio.currentTime = 5
    audio.emit('timeupdate')
    expect(engine.getSnapshot().currentTime).toBe(30)

    engine.endSeek(30)
    audio.currentTime = 31
    audio.emit('timeupdate')
    expect(engine.getSnapshot().currentTime).toBe(31)
  })

  it('notifies subscribers on state changes', async () => {
    const { engine } = setup()
    let notifications = 0
    const unsubscribe = engine.subscribe(() => {
      notifications += 1
    })

    await engine.loadFile(fakeFile('a.mp3'))
    engine.setVolume(0.5)
    expect(notifications).toBeGreaterThanOrEqual(2)
    expect(engine.getSnapshot().volume).toBe(0.5)

    unsubscribe()
    const before = notifications
    engine.setVolume(0.7)
    expect(notifications).toBe(before)
  })
})
