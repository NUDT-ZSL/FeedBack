import type { EffectRecord } from './types'

/**
 * 纯函数 DSP：当前音频 = 原始采样按已生效记录序列重放。
 * 撤销/重做/跳转只需改变生效前缀长度再重新推导，不存在第二份音频状态。
 */

function sliceRange(samples: Float32Array, sampleRate: number, range: { in: number; out: number }) {
  const start = Math.max(0, Math.min(samples.length, Math.round(range.in * sampleRate)))
  const end = Math.max(start, Math.min(samples.length, Math.round(range.out * sampleRate)))
  return { start, end }
}

function applyFade(samples: Float32Array, sampleRate: number, rec: EffectRecord, from: number, to: number) {
  const p = (rec.type === 'fadeIn' ? rec.params.fadeIn : rec.params.fadeOut) ?? { start: 0, end: 1, duration: 1 }
  const { start, end } = sliceRange(samples, sampleRate, rec.range)
  const rampLen = Math.min(end - start, Math.max(1, Math.round(p.duration * sampleRate)))
  for (let i = 0; i < rampLen; i++) {
    const t = rampLen === 1 ? 1 : i / (rampLen - 1)
    samples[start + i] *= from + (to - from) * t
  }
}

function applyEcho(samples: Float32Array, sampleRate: number, rec: EffectRecord) {
  const p = rec.params.echo ?? { delay: 0.3, decay: 0.5 }
  const { start, end } = sliceRange(samples, sampleRate, rec.range)
  const delaySamples = Math.max(1, Math.round(p.delay * sampleRate))
  const original = samples.slice(start, end)
  for (let i = delaySamples; i < end - start; i++) {
    samples[start + i] += original[i - delaySamples] * p.decay
  }
}

function applySpeed(samples: Float32Array, sampleRate: number, rec: EffectRecord): Float32Array {
  // 定长重采样：区间内容按 rate 变速，时间轴长度不变，
  // 保证历史记录里的区间始终落在同一时间轴上。
  const rate = rec.params.speed?.rate ?? 1
  const { start, end } = sliceRange(samples, sampleRate, rec.range)
  const region = samples.slice(start, end)
  const resampledLen = Math.max(1, Math.round(region.length / rate))
  const resampled = new Float32Array(resampledLen)
  for (let i = 0; i < resampledLen; i++) {
    const src = i * rate
    const i0 = Math.min(region.length - 1, Math.floor(src))
    const i1 = Math.min(region.length - 1, i0 + 1)
    const frac = src - i0
    resampled[i] = region[i0] * (1 - frac) + region[i1] * frac
  }
  for (let i = 0; i < region.length; i++) {
    const src = i < resampledLen ? (i * resampledLen) / region.length : resampledLen - 1
    const i0 = Math.min(resampledLen - 1, Math.floor(src))
    const i1 = Math.min(resampledLen - 1, i0 + 1)
    const frac = src - i0
    region[i] = resampled[i0] * (1 - frac) + resampled[i1] * frac
  }
  const out = samples.slice()
  out.set(region, start)
  return out
}

function applyReverse(samples: Float32Array, sampleRate: number, rec: EffectRecord) {
  const { start, end } = sliceRange(samples, sampleRate, rec.range)
  for (let i = start, j = end - 1; i < j; i++, j--) {
    const tmp = samples[i]
    samples[i] = samples[j]
    samples[j] = tmp
  }
}

/** 对采样应用一条记录，返回新数组（变速会改变长度） */
export function applyRecord(samples: Float32Array, sampleRate: number, rec: EffectRecord): Float32Array {
  const out = samples.slice()
  switch (rec.type) {
    case 'fadeIn':
      applyFade(out, sampleRate, rec, rec.params.fadeIn?.start ?? 0, rec.params.fadeIn?.end ?? 1)
      return out
    case 'fadeOut':
      applyFade(out, sampleRate, rec, rec.params.fadeOut?.start ?? 1, rec.params.fadeOut?.end ?? 0)
      return out
    case 'echo':
      applyEcho(out, sampleRate, rec)
      return out
    case 'speed':
      return applySpeed(out, sampleRate, rec)
    case 'reverse':
      applyReverse(out, sampleRate, rec)
      return out
  }
}

/** 从原始采样 + 记录序列重放出当前音频 */
export function renderAudio(original: Float32Array, sampleRate: number, records: EffectRecord[]): Float32Array {
  return records.reduce((acc, rec) => applyRecord(acc, sampleRate, rec), original.slice())
}
