/**
 * 纯函数音频效果处理（单声道 Float32Array，可在 Node 中离线运行）。
 * renderEffectChain 从原始采样 + 效果序列重新推导当前音频，
 * 与 editorEngine.deriveAtIndex 配合，保证音频状态永远等于序列重放结果。
 */

import type { AppliedEffect, EffectParams, SelectionRange } from './editorEngine.ts'

function rangeToSamples(range: SelectionRange, sampleRate: number, length: number): [number, number] {
  const start = Math.max(0, Math.min(length, Math.round(range.inPoint * sampleRate)))
  const end = Math.max(start, Math.min(length, Math.round(range.outPoint * sampleRate)))
  return [start, end]
}

function applyFade(
  samples: Float32Array,
  sampleRate: number,
  range: SelectionRange,
  from: number,
  to: number,
  duration: number,
): Float32Array {
  const out = new Float32Array(samples)
  const [start, end] = rangeToSamples(range, sampleRate, samples.length)
  const fadeLength = Math.min(Math.round(duration * sampleRate), end - start)
  if (fadeLength <= 0) return out
  const anchor = from < to ? start : end - fadeLength
  for (let i = 0; i < fadeLength; i += 1) {
    const gain = from + ((to - from) * i) / fadeLength
    out[anchor + i] = samples[anchor + i] * gain
  }
  return out
}

function applyEcho(
  samples: Float32Array,
  sampleRate: number,
  range: SelectionRange,
  delay: number,
  decay: number,
): Float32Array {
  const out = new Float32Array(samples)
  const [start, end] = rangeToSamples(range, sampleRate, samples.length)
  const delaySamples = Math.round(delay * sampleRate)
  for (let i = start + delaySamples; i < end; i += 1) {
    out[i] = samples[i] + samples[i - delaySamples] * decay
  }
  return out
}

function applySpeed(
  samples: Float32Array,
  sampleRate: number,
  range: SelectionRange,
  rate: number,
): Float32Array {
  const [start, end] = rangeToSamples(range, sampleRate, samples.length)
  const regionLength = end - start
  if (regionLength <= 0 || rate <= 0) return new Float32Array(samples)
  const newRegionLength = Math.max(1, Math.round(regionLength / rate))
  const out = new Float32Array(samples.length - regionLength + newRegionLength)
  out.set(samples.subarray(0, start), 0)
  for (let i = 0; i < newRegionLength; i += 1) {
    const pos = (i * regionLength) / newRegionLength
    const base = Math.floor(pos)
    const frac = pos - base
    const a = samples[start + Math.min(base, regionLength - 1)]
    const b = samples[start + Math.min(base + 1, regionLength - 1)]
    out[start + i] = a + (b - a) * frac
  }
  out.set(samples.subarray(end), start + newRegionLength)
  return out
}

function applyReverse(
  samples: Float32Array,
  sampleRate: number,
  range: SelectionRange,
): Float32Array {
  const out = new Float32Array(samples)
  const [start, end] = rangeToSamples(range, sampleRate, samples.length)
  for (let i = 0; i < end - start; i += 1) {
    out[start + i] = samples[end - 1 - i]
  }
  return out
}

export function applyEffectToSamples(
  samples: Float32Array,
  sampleRate: number,
  effect: AppliedEffect,
): Float32Array {
  const { range, params } = effect
  switch (effect.effect) {
    case 'fadeIn': {
      const p = params.fadeIn ?? { start: 0, end: 1, duration: 2 }
      return applyFade(samples, sampleRate, range, p.start, p.end, p.duration)
    }
    case 'fadeOut': {
      const p = params.fadeOut ?? { start: 1, end: 0, duration: 2 }
      return applyFade(samples, sampleRate, range, p.start, p.end, p.duration)
    }
    case 'echo': {
      const p = params.echo ?? { delay: 0.3, decay: 0.5 }
      return applyEcho(samples, sampleRate, range, p.delay, p.decay)
    }
    case 'speed': {
      const p = params.speed ?? { rate: 1 }
      return applySpeed(samples, sampleRate, range, p.rate)
    }
    case 'reverse':
      return applyReverse(samples, sampleRate, range)
  }
}

/** 从原始采样按顺序重放效果链，得到当前音频 */
export function renderEffectChain(
  original: Float32Array,
  sampleRate: number,
  effects: AppliedEffect[],
): Float32Array {
  return effects.reduce(
    (samples, effect) => applyEffectToSamples(samples, sampleRate, effect),
    original,
  )
}

export type { EffectParams, SelectionRange }
