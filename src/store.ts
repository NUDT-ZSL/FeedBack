/**
 * 全局状态（zustand）。
 *
 * 拆装的全部业务判断（顺序、依赖、重复操作、进度结论）都委托给
 * src/assembly/ 的步骤状态机；store 只负责：
 *   - 持有最近一次推演快照（部件状态 / 步骤 / 受阻原因 / 进度结论）
 *   - 界面态：高亮部件、警告文字、提示闪烁
 * 交互回调不再各自改写顺序或进度，只向状态机提交操作并读取快照。
 */
import { create } from 'zustand';
import { AssemblyMachine } from './assembly/machine.ts';
import { ARMILLARY_PARTS } from './assembly/parts.ts';
import type { PartId, StepSnapshot } from './assembly/types.ts';

/** 铜钟声效：Web Audio 合成 440Hz 短音 */
function playBell(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audio = new Ctx();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.25, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.6);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.6);
    oscillator.onended = () => void audio.close();
  } catch {
    // 无音频环境时静默
  }
}

let machine = new AssemblyMachine(ARMILLARY_PARTS);

interface AssemblyStore {
  snapshot: StepSnapshot;
  highlightId: PartId | null;
  warning: string | null;
  assembling: boolean;
  disassemble: (partId: PartId) => void;
  assembleNext: () => boolean;
  assembleAll: () => void;
  reset: () => void;
  hint: () => void;
  clearWarning: () => void;
}

export const useAssemblyStore = create<AssemblyStore>((set, get) => ({
  snapshot: machine.snapshot(),
  highlightId: null,
  warning: null,
  assembling: false,

  disassemble: (partId) => {
    const outcome = machine.apply({ type: 'disassemble', partId });
    set({ snapshot: machine.snapshot({ type: 'disassemble', partId }, outcome) });
    if (!outcome.ok && outcome.reason) {
      set({ warning: outcome.reason.message });
      window.setTimeout(() => {
        if (get().warning === outcome.reason?.message) set({ warning: null });
      }, 3000);
    }
  },

  /** 装回下一个可装部件；返回是否执行了有效装回 */
  assembleNext: () => {
    const hint = machine.nextHint();
    if (!hint || hint.kind !== 'assemble') return false;
    const outcome = machine.apply({ type: 'assemble', partId: hint.partId });
    set({ snapshot: machine.snapshot({ type: 'assemble', partId: hint.partId }, outcome) });
    if (outcome.ok) playBell();
    return outcome.ok;
  },

  /** 逆向组装：按状态机推导的顺序逐个装回 */
  assembleAll: () => {
    if (get().assembling) return;
    set({ assembling: true });
    const step = () => {
      const moved = get().assembleNext();
      if (moved) {
        window.setTimeout(step, 850);
      } else {
        set({ assembling: false });
      }
    };
    step();
  },

  reset: () => {
    machine = new AssemblyMachine(ARMILLARY_PARTS);
    set({ snapshot: machine.snapshot(), warning: null, highlightId: null, assembling: false });
  },

  hint: () => {
    const next = machine.nextHint();
    if (!next) return;
    set({ highlightId: next.partId });
    window.setTimeout(() => {
      if (get().highlightId === next.partId) set({ highlightId: null });
    }, 1200);
  },

  clearWarning: () => set({ warning: null }),
}));
