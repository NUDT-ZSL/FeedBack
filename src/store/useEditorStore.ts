import { create } from 'zustand'
import {
  applyEffect as engineApplyEffect,
  beginJump as engineBeginJump,
  beginRedo as engineBeginRedo,
  beginUndo as engineBeginUndo,
  completeJump as engineCompleteJump,
  createInitialState,
  deriveAtIndex,
  loadAudio as engineLoadAudio,
  setInPoint as engineSetInPoint,
  setOutPoint as engineSetOutPoint,
  type EditorState,
  type EffectParams,
  type EffectType,
} from '@/lib/editorEngine'
import { renderEffectChain } from '@/lib/audioEffects'

const JUMP_DURATION_MS = 300

interface EditorStore extends EditorState {
  fileName: string | null
  sampleRate: number
  originalSamples: Float32Array | null
  processedSamples: Float32Array | null
  hasAudio: boolean

  loadFromBuffer: (fileName: string, samples: Float32Array, sampleRate: number) => void
  setInPoint: (time: number) => void
  setOutPoint: (time: number) => void
  applyEffect: (effect: EffectType, params: EffectParams) => void
  undo: () => void
  redo: () => void
  jumpTo: (index: number) => void

  exportSamples: () => { samples: Float32Array; sampleRate: number } | null
}

/**
 * 状态推进后，从原始采样 + 当前效果链重新渲染音频。
 * 音频不单独增量维护，始终是效果序列的重放结果。
 */
function withRenderedAudio(
  state: EditorStore,
  next: EditorState,
): EditorState & Pick<EditorStore, 'processedSamples'> {
  if (!state.originalSamples) {
    return { ...next, processedSamples: null }
  }
  const { effects } = deriveAtIndex(next.history, next.historyIndex)
  const processedSamples = renderEffectChain(state.originalSamples, state.sampleRate, effects)
  return { ...next, duration: processedSamples.length / state.sampleRate, processedSamples }
}

export const useEditorStore = create<EditorStore>((set, get) => {
  /** 效果类操作：推进序列并从序列重放音频 */
  const applyTransition = (next: EditorState) => {
    if (next === get()) return
    set((state) => withRenderedAudio(state, next))
  }

  /** 两阶段跳转（撤销 / 重做 / 跳转共用）：先置忙碌态，动画结束再落地 */
  const beginTimedTransition = (next: EditorState) => {
    if (next === get()) return
    set(next)
    window.setTimeout(() => {
      set((current) => withRenderedAudio(current, engineCompleteJump(current)))
    }, JUMP_DURATION_MS)
  }

  return {
    ...createInitialState(),
    fileName: null,
    sampleRate: 44100,
    originalSamples: null,
    processedSamples: null,
    hasAudio: false,

    loadFromBuffer: (fileName, samples, sampleRate) => {
      const duration = samples.length / sampleRate
      set((state) =>
        withRenderedAudio(
          { ...state, sampleRate, originalSamples: samples },
          engineLoadAudio(state, duration),
        ),
      )
      set({ fileName, sampleRate, originalSamples: samples, hasAudio: true })
    },

    setInPoint: (time) => {
      const next = engineSetInPoint(get(), time)
      if (next !== get()) set(next)
    },

    setOutPoint: (time) => {
      const next = engineSetOutPoint(get(), time)
      if (next !== get()) set(next)
    },

    applyEffect: (effect, params) => {
      applyTransition(engineApplyEffect(get(), effect, params))
    },

    undo: () => beginTimedTransition(engineBeginUndo(get())),

    redo: () => beginTimedTransition(engineBeginRedo(get())),

    jumpTo: (index) => beginTimedTransition(engineBeginJump(get(), index)),

    exportSamples: () => {
      const { processedSamples, sampleRate } = get()
      if (!processedSamples) return null
      return { samples: processedSamples, sampleRate }
    },
  }
})
