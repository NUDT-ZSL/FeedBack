import type { AlignmentState } from './types'

export function acceptanceSample(): AlignmentState {
  return {
    media: { duration: 600, frameRate: 25 },
    anchors: [
      { id: 'a1', mediaTime: 10, segmentId: 'seg1', note: '片头对白校准点' },
      { id: 'a2', mediaTime: 100, segmentId: 'seg3', note: '第一场转场（字幕整体偏早）' },
      { id: 'a3', mediaTime: 300, segmentId: 'seg-missing', note: '指向已删除片段的失效锚点' },
      { id: 'a4', mediaTime: 500, segmentId: 'seg8', note: '片尾校准点（漂移继续增大）' },
    ],
    segments: [
      { id: 'seg1', start: 10, end: 12, text: '各位观众晚上好', source: '人工' },
      { id: 'seg2', start: 11.5, end: 13.5, text: '欢迎收看本期节目', source: '人工' },
      { id: 'seg3', start: 97, end: 100, text: '首先来看第一条新闻', source: '人工' },
      { id: 'seg4', start: 147, end: 149, text: '现场记者发回报道', source: 'ASR-A' },
      { id: 'seg5', start: 145, end: 148, text: '记者在现场报道', source: 'ASR-A' },
      { id: 'seg6', start: 196, end: 198, text: '今天气温明显下降', source: 'ASR-A' },
      { id: 'seg7', start: 196, end: 197.5, text: '今天气温明显上升', source: 'ASR-B' },
      { id: 'seg8', start: 494, end: 497, text: '本期节目到此结束', source: '人工' },
      { id: 'seg9', start: 400, end: 395, text: '感谢收看', source: 'ASR-B' },
    ],
    adjudications: [],
  }
}
