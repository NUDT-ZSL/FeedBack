/**
 * 前端统一状态层：三个模块（工序 / 材料 / 记录）共用同一个 store。
 *
 * 数据来源是后端同一份 WorkshopStore（/api/workshop/state），
 * 任何一次操作完成后重新拉取统一快照，三个面板立即读到同一结果。
 */
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { OpResult, Operation, WorkshopSnapshot } from '@/domain/workshop';

const DEFAULT_ACTOR = '拓印师';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type OpDraft = DistributiveOmit<Operation, 'opId' | 'expectedVersion' | 'actor'>;

interface WorkshopState {
  snapshot: WorkshopSnapshot | null;
  loading: boolean;
  error: string | null;
  lastResult: OpResult | null;
  actor: string;
  refresh: () => Promise<void>;
  setActor: (actor: string) => void;
  submitOp: (draft: OpDraft) => Promise<OpResult>;
  /** 并发模拟：两个操作者基于同一版本同时提交，后到者必须留下冲突痕迹 */
  simulateConflict: (bookId: string) => Promise<void>;
}

async function fetchState(): Promise<WorkshopSnapshot> {
  const res = await fetch('/api/workshop/state');
  if (!res.ok) throw new Error(`读取统一状态失败: ${res.status}`);
  const body = (await res.json()) as { success: boolean; data: WorkshopSnapshot };
  return body.data;
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  lastResult: null,
  actor: DEFAULT_ACTOR,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await fetchState();
      set({ snapshot, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  setActor: (actor) => set({ actor: actor.trim() || DEFAULT_ACTOR }),

  submitOp: async (draft) => {
    const { snapshot, actor, refresh } = get();
    const progress = snapshot?.progress.find((p) => p.bookId === draft.bookId);
    const op: Operation = {
      ...draft,
      opId: uuidv4(),
      expectedVersion: progress?.version ?? 0,
      actor,
    } as Operation;
    const res = await fetch('/api/workshop/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    });
    const body = (await res.json()) as { success: boolean; data?: OpResult; error?: string };
    const result = body.data ?? null;
    set({ lastResult: result, error: body.success ? null : body.error ?? null });
    await refresh();
    return result as OpResult;
  },

  simulateConflict: async (bookId) => {
    const { snapshot, actor, refresh } = get();
    const progress = snapshot?.progress.find((p) => p.bookId === bookId);
    const expectedVersion = progress?.version ?? 0;
    // 两个操作携带完全相同的快照版本并发提交
    const ops: Operation[] = [
      { kind: 'advance_stage', opId: uuidv4(), bookId, expectedVersion, actor: `${actor}（端A）`, toStageId: 'mend' },
      { kind: 'advance_stage', opId: uuidv4(), bookId, expectedVersion, actor: `${actor}（端B）`, toStageId: 'bind' },
    ];
    await Promise.all(
      ops.map((op) =>
        fetch('/api/workshop/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op),
        }),
      ),
    );
    await refresh();
  },
}));
