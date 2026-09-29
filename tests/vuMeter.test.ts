import { describe, expect, it } from 'vitest'
import { sampleVULevels } from '../src/core/vuMeter'

const peaks = { getChannelPeaks: () => ({ left: 0.6, right: 0.4 }) }

describe('sampleVULevels', () => {
  it('returns real peaks only while playing and not seeking', () => {
    expect(sampleVULevels(peaks, true, false)).toEqual({ left: 0.6, right: 0.4 })
  })

  it('reads zero when paused or stopped', () => {
    expect(sampleVULevels(peaks, false, false)).toEqual({ left: 0, right: 0 })
  })

  it('reads zero while the seek bar is being dragged', () => {
    expect(sampleVULevels(peaks, true, true)).toEqual({ left: 0, right: 0 })
    expect(sampleVULevels(peaks, false, true)).toEqual({ left: 0, right: 0 })
  })

  it('reads zero without an analyzer', () => {
    expect(sampleVULevels(null, true, false)).toEqual({ left: 0, right: 0 })
  })

  it('clamps out-of-range peaks', () => {
    const wild = { getChannelPeaks: () => ({ left: 1.7, right: Number.NaN }) }
    expect(sampleVULevels(wild, true, false)).toEqual({ left: 1, right: 0 })
  })
})
