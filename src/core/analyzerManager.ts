import { AudioAnalyzer, type AudioContextFactory } from '../utils/audioAnalyzer'

export interface AnalyzerManagerDeps {
  contextFactory?: AudioContextFactory
}

/**
 * Owns the lifecycle of the AudioAnalyzer.
 *
 * Guarantees:
 * - At most one active (non-disposed) analyzer exists at any moment.
 * - Re-attaching the same audio element reuses the existing analyzer and
 *   its Web Audio graph (no new nodes, no doubled sound).
 * - Attaching a different element disposes the previous analyzer
 *   (all nodes disconnected, AudioContext closed) before creating a new one.
 */
export class AnalyzerManager {
  private analyzer: AudioAnalyzer | null = null
  private element: HTMLAudioElement | null = null
  private readonly deps: AnalyzerManagerDeps

  constructor(deps: AnalyzerManagerDeps = {}) {
    this.deps = deps
  }

  get current(): AudioAnalyzer | null {
    return this.analyzer
  }

  /** Number of live analyzers right now. Invariant: always 0 or 1. */
  get activeCount(): number {
    return this.analyzer !== null && !this.analyzer.isDisposed ? 1 : 0
  }

  attach(element: HTMLAudioElement): AudioAnalyzer {
    if (this.analyzer && this.element === element && !this.analyzer.isDisposed) {
      // Same element: the existing graph (source -> analysers -> destination)
      // stays valid across src changes, so reuse it as-is.
      return this.analyzer
    }

    this.release()

    const analyzer = new AudioAnalyzer(this.deps.contextFactory)
    analyzer.connect(element)
    this.analyzer = analyzer
    this.element = element
    return analyzer
  }

  release(): void {
    if (this.analyzer) {
      this.analyzer.dispose()
      this.analyzer = null
      this.element = null
    }
  }
}
