import type { DerivationInput } from './types';

/**
 * 验收数据集：刻意包含倒序时刻、重叠区间、缺失锚点目标、
 * 同一时刻多条来源矛盾片段，用于验证异常保留与增量重推一致性。
 */
export function buildAcceptanceDataset(): DerivationInput {
  return {
    media: { durationMs: 120_000, frameRate: 25 },
    anchors: [
      { id: 'A1', mediaTimeMs: 10_000, segmentId: 'S1' },
      { id: 'A2', mediaTimeMs: 50_500, segmentId: 'S4' },
      { id: 'A3', mediaTimeMs: 90_000, segmentId: 'S_MISSING' },
    ],
    segments: [
      { id: 'S1', startMs: 10_000, endMs: 12_000, text: '开场白，欢迎各位。', source: 'asr' },
      { id: 'S2', startMs: 20_000, endMs: 18_000, text: '这句的起止时刻被录反了。', source: 'asr' },
      { id: 'S3a', startMs: 30_000, endMs: 33_000, text: '同一时刻的识别文本（甲）。', source: 'asr' },
      { id: 'S3b', startMs: 30_000, endMs: 32_500, text: '同一时刻的人工校对文本（乙）。', source: 'manual' },
      { id: 'S4', startMs: 50_000, endMs: 53_000, text: '中段台词，锚点 A2 指向这里。', source: 'asr' },
      { id: 'S5', startMs: 52_000, endMs: 55_000, text: '与上一句存在重叠区间。', source: 'asr' },
      { id: 'S6', startMs: 70_000, endMs: 73_000, text: '结尾台词。', source: 'manual' },
    ],
    adjudications: [],
  };
}
