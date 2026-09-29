import { describe, expect, it } from 'vitest'
import { AnalyzerManager } from '../src/core/analyzerManager'
import { AudioAnalyzer } from '../src/utils/audioAnalyzer'
import {
  FakeAudioElement,
  FakeAudioNode,
  createContextFactoryRegistry,
} from './helpers/fakes'

const asElement = (el: FakeAudioElement) => el as unknown as HTMLAudioElement

describe('AnalyzerManager', () => {
  it('reuses a single analyzer across repeated uploads on the same element', () => {
    const { contexts, factory } = createContextFactoryRegistry()
    const manager = new AnalyzerManager({ contextFactory: factory })
    const el = asElement(new FakeAudioElement())

    const first = manager.attach(el)
    const second = manager.attach(el)
    const third = manager.attach(el)

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(manager.activeCount).toBe(1)
    expect(contexts).toHaveLength(1)
  })

  it('disposes the old analyzer before attaching a different element', () => {
    const { contexts, factory } = createContextFactoryRegistry()
    const manager = new AnalyzerManager({ contextFactory: factory })

    const old = manager.attach(asElement(new FakeAudioElement()))
    const next = manager.attach(asElement(new FakeAudioElement()))

    expect(next).not.toBe(old)
    expect(old.isDisposed).toBe(true)
    expect(manager.activeCount).toBe(1)
    expect(contexts).toHaveLength(2)
    expect(contexts[0].closeCount).toBe(1)
    expect(contexts[0].state).toBe('closed')
  })

  it('release() disposes the active analyzer and drops the count to zero', () => {
    const { contexts, factory } = createContextFactoryRegistry()
    const manager = new AnalyzerManager({ contextFactory: factory })

    manager.attach(asElement(new FakeAudioElement()))
    expect(manager.activeCount).toBe(1)

    manager.release()
    expect(manager.activeCount).toBe(0)
    expect(manager.current).toBeNull()
    expect(contexts[0].closeCount).toBe(1)

    // release is idempotent
    manager.release()
    expect(contexts[0].closeCount).toBe(1)
  })
})

describe('AudioAnalyzer node lifecycle', () => {
  it('reconnecting disconnects every previously created node', () => {
    const { contexts, factory } = createContextFactoryRegistry()
    const analyzer = new AudioAnalyzer(factory)
    const el = asElement(new FakeAudioElement())

    analyzer.connect(el)
    const oldNodes = [
      analyzer.source,
      analyzer.analyser,
      analyzer.splitter,
      analyzer.leftAnalyser,
      analyzer.rightAnalyser,
    ] as unknown as FakeAudioNode[]

    analyzer.connect(el)

    for (const node of oldNodes) {
      expect(node.disconnectCount).toBeGreaterThanOrEqual(1)
    }
    // Same AudioContext reused; only the node graph was rebuilt.
    expect(contexts).toHaveLength(1)
    expect(contexts[0].sources).toHaveLength(2)
  })

  it('dispose() disconnects all nodes and closes the context exactly once', () => {
    const { contexts, factory } = createContextFactoryRegistry()
    const analyzer = new AudioAnalyzer(factory)
    analyzer.connect(asElement(new FakeAudioElement()))

    const nodes = [
      analyzer.source,
      analyzer.analyser,
      analyzer.splitter,
      analyzer.leftAnalyser,
      analyzer.rightAnalyser,
    ] as unknown as FakeAudioNode[]

    analyzer.dispose()

    expect(analyzer.isDisposed).toBe(true)
    for (const node of nodes) {
      expect(node.disconnectCount).toBeGreaterThanOrEqual(1)
    }
    expect(analyzer.source).toBeNull()
    expect(analyzer.analyser).toBeNull()
    expect(contexts[0].closeCount).toBe(1)

    analyzer.dispose()
    expect(contexts[0].closeCount).toBe(1)
  })
})
