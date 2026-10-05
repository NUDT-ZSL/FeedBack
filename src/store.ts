/**
 * 全局状态（zustand）。
 * 所有拆装判断都委托给 src/assembly 的纯函数状态机：
 * 交互回调只负责「发操作、读结论」，不再各自改写顺序/依赖/进度口径。
 */
import { create } from 'zustand';
import {
  applyOperation,
  createSession,
  nextDetachable,
  resetSession,
} from './assembly/machine.ts';
import { ARMILLARY_CONFIG } from './assembly/armillary.ts';
import type { OpOutcome, PartId, Session } from './assembly/types.ts';

interface AssemblyStore {
  session: Session;
  selected: PartId | null;
  hinted: PartId | null;
  warning: string | null;
  detach: (part: PartId) => void;
  attach: (part: PartId) => void;
  reset: () => void;
  hintNext: () => void;
  assembleAll: () => void;
  select: (part: PartId | null) => void;
  dismissWarning: () => void;
}

const nameOf = (session: Session, id: PartId): string =>
  session.config.parts.find((p) => p.id === id)?.name ?? id;

function describeOutcome(session: Session, outcome: OpOutcome): string | null {
  if (outcome.result === 'applied') return null;
  if (outcome.result === 'invalid') {
    switch (outcome.reason) {
      case 'duplicate-detach':
        return '该部件已拆下，重复拆下为无效操作';
      case 'duplicate-attach':
        return '该部件已在位，重复装回为无效操作';
      case 'unknown-part':
        return '未知部件，操作无效';
    }
  }
  const reason = outcome.reason;
  if (reason.kind === 'unmet-dependencies') {
    return `顺序偏差！请先处理：${reason.pending.map((id) => nameOf(session, id)).join('、')}`;
  }
  if (reason.kind === 'missing-dependency') {
    return `依赖缺失（${reason.missing.join('、')}），该部件不可达`;
  }
  return `依赖成环（${reason.cycle.join(' → ')}），该部件不可达`;
}

let assembleTimer: ReturnType<typeof setInterval> | null = null;
const stopAssembleTimer = () => {
  if (assembleTimer !== null) {
    clearInterval(assembleTimer);
    assembleTimer = null;
  }
};

export const useAssemblyStore = create<AssemblyStore>((set, get) => {
  const apply = (part: PartId, kind: 'detach' | 'attach') => {
    const { session } = get();
    const { session: next, outcome } = applyOperation(session, { kind, part });
    const warning = describeOutcome(next, outcome);
    set({ session: next, warning, hinted: null });
    return outcome;
  };

  return {
    session: createSession(ARMILLARY_CONFIG),
    selected: null,
    hinted: null,
    warning: null,

    detach: (part) => {
      apply(part, 'detach');
    },
    attach: (part) => {
      apply(part, 'attach');
    },
    reset: () => {
      stopAssembleTimer();
      set((state) => ({
        session: resetSession(state.session),
        selected: null,
        hinted: null,
        warning: null,
      }));
    },
    hintNext: () => {
      const [next] = nextDetachable(get().session);
      set({
        hinted: next ?? null,
        warning: next ? null : '当前没有可直接拆下的部件',
      });
    },
    assembleAll: () => {
      stopAssembleTimer();
      assembleTimer = setInterval(() => {
        const { session } = get();
        const nextPart = Object.values(session.derivation.parts).find(
          (p) => p.step.status === 'attachable',
        );
        if (!nextPart) {
          stopAssembleTimer();
          return;
        }
        get().attach(nextPart.part);
      }, 400);
    },
    select: (part) => set({ selected: part }),
    dismissWarning: () => set({ warning: null }),
  };
});
