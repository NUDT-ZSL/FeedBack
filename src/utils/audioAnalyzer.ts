export type AudioContextFactory = () => AudioContext

const defaultContextFactory: AudioContextFactory = () =>
  new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

export class AudioAnalyzer {
  audioContext: AudioContext | null = null
  analyser: AnalyserNode | null = null
  source: MediaElementAudioSourceNode | null = null
  splitter: ChannelSplitterNode | null = null
  leftAnalyser: AnalyserNode | null = null
  rightAnalyser: AnalyserNode | null = null
  frequencyData: Uint8Array
  timeDomainData: Uint8Array
  leftChannelData: Uint8Array
  rightChannelData: Uint8Array
  private disposed = false
  private contextFactory: AudioContextFactory

  constructor(contextFactory: AudioContextFactory = defaultContextFactory) {
    this.contextFactory = contextFactory
    this.frequencyData = new Uint8Array(0)
    this.timeDomainData = new Uint8Array(0)
    this.leftChannelData = new Uint8Array(0)
    this.rightChannelData = new Uint8Array(0)
  }

  connect(audioElement: HTMLAudioElement): void {
    if (this.disposed) {
      throw new Error('AudioAnalyzer has been disposed')
    }
    if (!this.audioContext) {
      this.audioContext = this.contextFactory()
    }

    // Always tear down any previously created nodes before wiring a new
    // graph, so reconnecting never leaves orphaned nodes behind.
    this.releaseNodes()

    const ctx = this.audioContext
    this.source = ctx.createMediaElementSource(audioElement)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.8

    this.splitter = ctx.createChannelSplitter(2)
    this.leftAnalyser = ctx.createAnalyser()
    this.rightAnalyser = ctx.createAnalyser()
    this.leftAnalyser.fftSize = 256
    this.rightAnalyser.fftSize = 256

    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount)
    this.timeDomainData = new Uint8Array(this.analyser.fftSize)
    this.leftChannelData = new Uint8Array(this.leftAnalyser.fftSize)
    this.rightChannelData = new Uint8Array(this.rightAnalyser.fftSize)

    this.source.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    this.source.connect(this.splitter)
    this.splitter.connect(this.leftAnalyser, 0)
    this.splitter.connect(this.rightAnalyser, 1)
  }

  private releaseNodes(): void {
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.analyser) {
      this.analyser.disconnect()
      this.analyser = null
    }
    if (this.splitter) {
      this.splitter.disconnect()
      this.splitter = null
    }
    if (this.leftAnalyser) {
      this.leftAnalyser.disconnect()
      this.leftAnalyser = null
    }
    if (this.rightAnalyser) {
      this.rightAnalyser.disconnect()
      this.rightAnalyser = null
    }
  }

  disconnect(): void {
    this.releaseNodes()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  dispose(): void {
    if (this.disposed) return
    this.releaseNodes()
    if (this.audioContext) {
      const ctx = this.audioContext
      this.audioContext = null
      if (ctx.state !== 'closed') {
        void ctx.close().catch(() => undefined)
      }
    }
    this.disposed = true
  }

  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  getFrequencyData(): Uint8Array {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.frequencyData)
    }
    return this.frequencyData
  }

  getTimeDomainData(): Uint8Array {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.timeDomainData)
    }
    return this.timeDomainData
  }

  getChannelPeaks(): { left: number; right: number } {
    let leftPeak = 0
    let rightPeak = 0

    if (this.leftAnalyser) {
      this.leftAnalyser.getByteTimeDomainData(this.leftChannelData)
      for (let i = 0; i < this.leftChannelData.length; i++) {
        const val = Math.abs(this.leftChannelData[i] - 128) / 128
        if (val > leftPeak) leftPeak = val
      }
    }

    if (this.rightAnalyser) {
      this.rightAnalyser.getByteTimeDomainData(this.rightChannelData)
      for (let i = 0; i < this.rightChannelData.length; i++) {
        const val = Math.abs(this.rightChannelData[i] - 128) / 128
        if (val > rightPeak) rightPeak = val
      }
    }

    return { left: leftPeak, right: rightPeak }
  }
}
