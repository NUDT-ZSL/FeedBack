// 对齐推演状态：所有数据变更都走增量重推，未受影响部分保持引用不变
import { create } from 'zustand';
import { recomputeAlignment, type ChangeSpec, type IncrementalState } from '@/alignment/incremental';
import type {
  Adjudication,
  AffectedRange,
  AlignmentInputs,
  AlignmentResult,
  Anchor,
  MediaInfo,
  SubtitleSegment,
} from '@/alignment/types';

let adjudicationSeq = 0;
let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

interface AlignmentStore extends IncrementalState {
  affected: AffectedRange | null;
  setMediaInfo: (patch: Partial<MediaInfo>) => void;
  addAnchor: (anchor: Omit<Anchor, 'id'> & { id?: string }) => void;
  updateAnchor: (id: string, patch: Partial<Omit<Anchor, 'id'>>) => void;
  removeAnchor: (id: string) => void;
  addSegment: (segment: Omit<SubtitleSegment, 'id'> & { id?: string }) => void;
  updateSegment: (id: string, patch: Partial<Omit<SubtitleSegment, 'id'>>) => void;
  removeSegment: (id: string) => void;
  adjudicate: (conflictId: string, chosenSegmentId: string, note?: string) => void;
  recomputeAll: () => void;
  loadSample: () => void;
}

function apply(
  state: IncrementalState,
  nextInputs: AlignmentInputs,
  change: ChangeSpec,
): IncrementalState & { affected: AffectedRange } {
  const { result, affected } = recomputeAlignment(state, nextInputs, change);
  return { inputs: nextInputs, result, affected };
}

function inputsOf(state: IncrementalState): AlignmentInputs {
  return state.inputs;
}

export function buildSampleInputs(): AlignmentInputs {
  const media: MediaInfo = { durationSec: 120, frameRate: 25 };
  const anchors: Anchor[] = [
    { id: 'anchor-1', mediaTimeSec: 10, subtitleTimeSec: 10, segmentId: 'seg-1' },
    { id: 'anchor-2', mediaTimeSec: 40, subtitleTimeSec: 42 },
    { id: 'anchor-3', mediaTimeSec: 80, subtitleTimeSec: 85, segmentId: 'seg-missing' },
  ];
  const segments: SubtitleSegment[] = [
    { id: 'seg-1', startSec: 5, endSec: 8, text: '开场白', source: '人工' },
    { id: 'seg-2', startSec: 12, endSec: 15, text: '第一句台词', source: 'ASR' },
    { id: 'seg-3', startSec: 20, endSec: 14, text: '时刻倒序的片段', source: 'ASR' },
    { id: 'seg-4', startSec: 30, endSec: 36, text: '重叠片段甲', source: 'ASR' },
    { id: 'seg-5', startSec: 34, endSec: 38, text: '重叠片段乙', source: '人工' },
    { id: 'seg-6', startSec: 50, endSec: 54, text: '同一时刻的版本A', source: 'ASR' },
    { id: 'seg-7', startSec: 50, endSec: 54, text: '同一时刻的版本B', source: 'OCR' },
    { id: 'seg-8', startSec: 90, endSec: 95, text: '片尾台词', source: '人工' },
    { id: 'seg-9', startSec: 118, endSec: 130, text: '超出媒体时长的片段', source: 'ASR' },
  ];
  return { media, anchors, segments, adjudications: [] };
}

const initialInputs = buildSampleInputs();
const initial = recomputeAlignment(null, initialInputs, { type: 'full', reason: '初始化样例数据' });

export const useAlignmentStore = create<AlignmentStore>((set, get) => ({
  inputs: initialInputs,
  result: initial.result,
  affected: initial.affected,

  setMediaInfo: (patch) => {
    const state = get();
    const next: AlignmentInputs = { ...inputsOf(state), media: { ...state.inputs.media, ...patch } };
    if (patch.frameRate !== undefined && patch.frameRate !== state.inputs.media.frameRate) {
      set(apply(state, next, { type: 'frame-rate' }));
    } else {
      set(apply(state, next, { type: 'full', reason: '媒体总时长变更：重检越界问题并整体重推' }));
    }
  },

  addAnchor: (anchor) => {
    const state = get();
    const id = anchor.id ?? nextId('anchor');
    const next: AlignmentInputs = {
      ...inputsOf(state),
      anchors: [...state.inputs.anchors, { ...anchor, id }],
    };
    set(apply(state, next, { type: 'anchor', anchorId: id }));
  },

  updateAnchor: (id, patch) => {
    const state = get();
    const next: AlignmentInputs = {
      ...inputsOf(state),
      anchors: state.inputs.anchors.map((a) => (a.id === id ? { ...a, ...patch, id } : a)),
    };
    set(apply(state, next, { type: 'anchor', anchorId: id }));
  },

  removeAnchor: (id) => {
    const state = get();
    const next: AlignmentInputs = {
      ...inputsOf(state),
      anchors: state.inputs.anchors.filter((a) => a.id !== id),
    };
    set(apply(state, next, { type: 'anchor', anchorId: id }));
  },

  addSegment: (segment) => {
    const state = get();
    const id = segment.id ?? nextId('seg');
    const next: AlignmentInputs = {
      ...inputsOf(state),
      segments: [...state.inputs.segments, { ...segment, id }],
    };
    set(apply(state, next, { type: 'segment', segmentId: id }));
  },

  updateSegment: (id, patch) => {
    const state = get();
    const next: AlignmentInputs = {
      ...inputsOf(state),
      segments: state.inputs.segments.map((s) => (s.id === id ? { ...s, ...patch, id } : s)),
    };
    set(apply(state, next, { type: 'segment', segmentId: id }));
  },

  removeSegment: (id) => {
    const state = get();
    const next: AlignmentInputs = {
      ...inputsOf(state),
      segments: state.inputs.segments.filter((s) => s.id !== id),
      // 指向被删片段的锚点会在重推时标记为 dangling-anchor，而不是静默忽略
    };
    set(apply(state, next, { type: 'segment', segmentId: id }));
  },

  adjudicate: (conflictId, chosenSegmentId, note) => {
    const state = get();
    const conflict = state.result.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    adjudicationSeq += 1;
    const adjudication: Adjudication = {
      id: nextId('adj'),
      conflictId,
      chosenSegmentId,
      rejectedSegmentIds: conflict.segmentIds.filter((sid) => sid !== chosenSegmentId),
      note,
      seq: adjudicationSeq,
      createdAt: Date.now(),
    };
    const next: AlignmentInputs = {
      ...inputsOf(state),
      adjudications: [...state.inputs.adjudications, adjudication],
    };
    set(apply(state, next, { type: 'adjudication', conflictId }));
  },

  recomputeAll: () => {
    const state = get();
    set(apply(state, state.inputs, { type: 'full', reason: '手动触发整体重推' }));
  },

  loadSample: () => {
    const inputs = buildSampleInputs();
    const { result, affected } = recomputeAlignment(null, inputs, { type: 'full', reason: '载入样例数据' });
    set({ inputs, result, affected });
  },
}));

export type { AlignmentResult };
