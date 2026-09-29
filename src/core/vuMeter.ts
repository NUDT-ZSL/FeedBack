export interface VULevels {
  left: number
  right: number
}

export interface PeakSource {
  getChannelPeaks(): VULevels
}

const SILENT: VULevels = { left: 0, right: 0 }

/**
 * Pure VU sampling policy: meters only show signal while audio is actually
 * playing and the user is not dragging the seek bar. Any other state
 * (paused, stopped, seeking, no analyzer) reads as zero.
 */
export function sampleVULevels(
  analyzer: PeakSource | null,
  isPlaying: boolean,
  isSeeking: boolean,
): VULevels {
  if (!analyzer || !isPlaying || isSeeking) {
    return { ...SILENT }
  }
  const peaks = analyzer.getChannelPeaks()
  return {
    left: clamp01(peaks.left),
    right: clamp01(peaks.right),
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}
