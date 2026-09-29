import { AnalyzerManager, type AnalyzerManagerDeps } from './analyzerManager'
import { sampleVULevels, type VULevels } from './vuMeter'

export interface EngineSnapshot {
  fileName: string
  isPlaying: boolean
  isSeeking: boolean
  currentTime: number
  duration: number
  volume: number
}

export interface AudioEngineDeps extends AnalyzerManagerDeps {
  createObjectUrl?: (file: Blob) => string
  revokeObjectUrl?: (url: string) => void
}

type Listener = () => void

const initialSnapshot: EngineSnapshot = {
  fileName: '',
  isPlaying: false,
  isSeeking: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
}

/**
 * Framework-agnostic playback engine. Owns the audio element wiring, the
 * analyzer lifecycle (via AnalyzerManager) and the playback/seek state.
 * Components subscribe to snapshots; nothing here depends on React, so the
 * whole chain can be driven and verified offline.
 */
export class AudioEngine {
  readonly analyzers: AnalyzerManager

  private state: EngineSnapshot = { ...initialSnapshot }
  private readonly listeners = new Set<Listener>()
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private readonly createObjectUrl: (file: Blob) => string
  private readonly revokeObjectUrl: (url: string) => void

  constructor(deps: AudioEngineDeps = {}) {
    this.analyzers = new AnalyzerManager({ contextFactory: deps.contextFactory })
    this.createObjectUrl = deps.createObjectUrl ?? ((file) => URL.createObjectURL(file))
    this.revokeObjectUrl = deps.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url))
  }

  getSnapshot(): EngineSnapshot {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(partial: Partial<EngineSnapshot>): void {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((listener) => listener())
  }

  attachElement(audio: HTMLAudioElement): void {
    if (this.audio === audio) return
    this.detachElement()
    this.audio = audio
    audio.addEventListener('loadedmetadata', this.handleLoadedMetadata)
    audio.addEventListener('timeupdate', this.handleTimeUpdate)
    audio.addEventListener('play', this.handlePlay)
    audio.addEventListener('pause', this.handlePause)
    audio.addEventListener('ended', this.handlePause)
  }

  detachElement(): void {
    if (!this.audio) return
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate)
    this.audio.removeEventListener('play', this.handlePlay)
    this.audio.removeEventListener('pause', this.handlePause)
    this.audio.removeEventListener('ended', this.handlePause)
    this.audio = null
  }

  async loadFile(file: Blob & { name: string }): Promise<void> {
    const audio = this.audio
    if (!audio) throw new Error('No audio element attached')

    if (this.objectUrl) {
      this.revokeObjectUrl(this.objectUrl)
      this.objectUrl = null
    }
    this.objectUrl = this.createObjectUrl(file)
    audio.src = this.objectUrl

    // Reuses the existing analyzer when possible; otherwise the old one is
    // fully disposed before the new one is created.
    const analyzer = this.analyzers.attach(audio)

    this.setState({ fileName: file.name, currentTime: 0, duration: 0 })

    await analyzer.resume()
    await audio.play()
  }

  async togglePlay(): Promise<void> {
    const audio = this.audio
    if (!audio || !this.state.fileName) return
    await this.analyzers.current?.resume()
    if (audio.paused) {
      await audio.play()
    } else {
      audio.pause()
    }
  }

  stop(): void {
    const audio = this.audio
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    this.setState({ currentTime: 0 })
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume))
    if (this.audio) {
      this.audio.volume = clamped
    }
    this.setState({ volume: clamped })
  }

  beginSeek(): void {
    if (!this.state.isSeeking) {
      this.setState({ isSeeking: true })
    }
  }

  previewSeek(time: number): void {
    this.setState({ currentTime: time })
  }

  endSeek(time: number): void {
    if (this.audio) {
      this.audio.currentTime = time
    }
    this.setState({ currentTime: time, isSeeking: false })
  }

  getVULevels(): VULevels {
    return sampleVULevels(this.analyzers.current, this.state.isPlaying, this.state.isSeeking)
  }

  dispose(): void {
    this.detachElement()
    this.analyzers.release()
    if (this.objectUrl) {
      this.revokeObjectUrl(this.objectUrl)
      this.objectUrl = null
    }
    this.listeners.clear()
  }

  private handleLoadedMetadata = (): void => {
    if (this.audio) {
      this.setState({ duration: this.audio.duration || 0 })
    }
  }

  private handleTimeUpdate = (): void => {
    if (this.audio && !this.state.isSeeking) {
      this.setState({ currentTime: this.audio.currentTime })
    }
  }

  private handlePlay = (): void => {
    this.setState({ isPlaying: true })
  }

  private handlePause = (): void => {
    this.setState({ isPlaying: false })
  }
}
