import { create } from 'zustand';
import {
  applyChange,
  buildAcceptanceDataset,
  deriveFull,
  inputOf,
  type Adjudication,
  type Anchor,
  type Change,
  type DerivationState,
  type MediaInfo,
  type SubtitleSegment,
} from '@/alignment';

export interface RunInfo {
  kind: 'full' | 'incremental';
  affectedIds: string[];
  consistentWithFull: boolean;
  changedAt: number;
}

interface AlignmentStore {
  state: DerivationState;
  lastRun: RunInfo | null;
  runCount: number;
  setMedia: (media: MediaInfo) => void;
  upsertAnchor: (anchor: Anchor) => void;
  removeAnchor: (anchorId: string) => void;
  upsertSegment: (segment: SubtitleSegment) => void;
  removeSegment: (segmentId: string) => void;
  adjudicate: (conflictKey: string, winnerSegmentId: string) => void;
  rerunFull: () => void;
  loadDataset: () => void;
}

function commit(prev: DerivationState, change: Change): { state: DerivationState; lastRun: RunInfo } {
  const result = applyChange(prev, change);
  const full = deriveFull(result.input);
  const consistentWithFull = JSON.stringify(result.state.conclusions) === JSON.stringify(full.conclusions);
  return {
    state: result.state,
    lastRun: {
      kind: 'incremental',
      affectedIds: result.affectedIds,
      consistentWithFull,
      changedAt: Date.now(),
    },
  };
}

function emptyState(): DerivationState {
  return deriveFull({
    media: { durationMs: 0, frameRate: 25 },
    segments: [],
    anchors: [],
    adjudications: [],
  });
}

let adjudicationSeq = 0;

export const useAlignmentStore = create<AlignmentStore>((set) => ({
  state: deriveFull(buildAcceptanceDataset()),
  lastRun: { kind: 'full', affectedIds: [], consistentWithFull: true, changedAt: Date.now() },
  runCount: 1,

  setMedia: (media) =>
    set((s) => ({ ...commit(s.state, { type: 'media', media }), runCount: s.runCount + 1 })),

  upsertAnchor: (anchor) =>
    set((s) => ({
      ...commit(s.state, { type: 'anchor-upsert', anchor }),
      runCount: s.runCount + 1,
    })),

  removeAnchor: (anchorId) =>
    set((s) => ({
      ...commit(s.state, { type: 'anchor-remove', anchorId }),
      runCount: s.runCount + 1,
    })),

  upsertSegment: (segment) =>
    set((s) => ({
      ...commit(s.state, { type: 'segment-upsert', segment }),
      runCount: s.runCount + 1,
    })),

  removeSegment: (segmentId) =>
    set((s) => ({
      ...commit(s.state, { type: 'segment-remove', segmentId }),
      runCount: s.runCount + 1,
    })),

  adjudicate: (conflictKey, winnerSegmentId) => {
    adjudicationSeq += 1;
    const adjudication: Adjudication = {
      id: `ADJ-${Date.now()}-${adjudicationSeq}`,
      conflictKey,
      winnerSegmentId,
    };
    set((s) => ({
      ...commit(s.state, { type: 'adjudicate', adjudication }),
      runCount: s.runCount + 1,
    }));
  },

  rerunFull: () =>
    set((s) => ({
      state: deriveFull(inputOf(s.state)),
      lastRun: { kind: 'full', affectedIds: [], consistentWithFull: true, changedAt: Date.now() },
      runCount: s.runCount + 1,
    })),

  loadDataset: () =>
    set({
      state: deriveFull(buildAcceptanceDataset()),
      lastRun: { kind: 'full', affectedIds: [], consistentWithFull: true, changedAt: Date.now() },
      runCount: 1,
    }),
}));

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export { emptyState };
