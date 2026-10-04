import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Music } from 'lucide-react'
import WaveformEditor from '@/components/WaveformEditor'
import EffectPanel from '@/components/EffectPanel'
import HistoryPanel from '@/components/HistoryPanel'
import {
  createState,
  loadAudio,
  setSelection,
  applyEffect,
  requestUndo,
  requestRedo,
  jumpTo,
  completeJump,
  deriveEffects,
  currentIndex,
} from '@/lib/workbench/engine'
import { renderAudio } from '@/lib/workbench/audio'
import type { EffectParams, EffectType, WorkbenchState } from '@/lib/workbench/types'

const JUMP_ANIMATION_MS = 300

export default function Home() {
  const [state, setState] = useState<WorkbenchState>(() => createState(0))
  const [zoomLevel, setZoomLevel] = useState(1)
  const [fileName, setFileName] = useState<string | null>(null)
  const originalRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null)
  const jumpTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 当前音频 = 原始采样按已生效效果链重放，单一事实来源
  const rendered = useMemo(() => {
    const original = originalRef.current
    if (!original) return null
    return renderAudio(original.samples, original.sampleRate, deriveEffects(state))
  }, [state])

  const clearJumpTimer = () => {
    if (jumpTimerRef.current !== null) {
      window.clearTimeout(jumpTimerRef.current)
      jumpTimerRef.current = null
    }
  }

  useEffect(() => clearJumpTimer, [])

  /** 撤销/重做/跳转统一入口：先进入可观察的 jumping 状态，动画结束后落盘 */
  const transitionTo = useCallback(
    (transition: (s: WorkbenchState) => WorkbenchState) => {
      setState((prev) => {
        const next = transition(prev)
        if (next === prev || next.jumpStatus !== 'jumping') return next
        clearJumpTimer()
        jumpTimerRef.current = window.setTimeout(() => {
          jumpTimerRef.current = null
          setState((s) => completeJump(s))
        }, JUMP_ANIMATION_MS)
        return next
      })
    },
    []
  )

  const handleUpload = useCallback(async (file: File) => {
    const arrayBuffer = await file.arrayBuffer()
    const ctx = new AudioContext()
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      originalRef.current = {
        samples: audioBuffer.getChannelData(0).slice(),
        sampleRate: audioBuffer.sampleRate,
      }
      setFileName(file.name)
      setZoomLevel(1)
      clearJumpTimer()
      setState(() => loadAudio(audioBuffer.duration))
    } finally {
      ctx.close()
    }
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleUpload(file)
      e.target.value = ''
    },
    [handleUpload]
  )

  const handleApplyEffect = useCallback(
    (type: EffectType, params: EffectParams) => {
      setState((prev) => applyEffect(prev, type, params))
    },
    []
  )

  const handleInPointChange = useCallback((time: number) => {
    setState((prev) => setSelection(prev, { in: time }))
  }, [])

  const handleOutPointChange = useCallback((time: number) => {
    setState((prev) => setSelection(prev, { out: time }))
  }, [])

  const isJumping = state.jumpStatus === 'jumping'
  const hasAudio = originalRef.current !== null && state.duration > 0

  const historyEntries = state.records.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    type: r.type,
    description: r.description,
    icon: r.type,
  }))

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: '#1a1a2e', color: '#e0e0e0' }}>
      <header className="flex items-center justify-between border-b border-gray-700 px-6 py-3">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-cyan-400" />
          <h1 className="text-base font-bold">播客工作台</h1>
          {fileName && <span className="text-xs text-gray-400">— {fileName}</span>}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
        >
          <Upload className="h-4 w-4" />
          上传音频
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="min-h-0 flex-1">
            {hasAudio && rendered ? (
              <WaveformEditor
                audioData={rendered}
                inPoint={state.selection.in}
                outPoint={state.selection.out}
                zoomLevel={zoomLevel}
                duration={state.duration}
                onInPointChange={handleInPointChange}
                onOutPointChange={handleOutPointChange}
                onZoomLevelChange={setZoomLevel}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg bg-gray-900 text-gray-500">
                <Music className="h-12 w-12 opacity-40" />
                <p className="text-sm">上传音频文件开始编辑</p>
              </div>
            )}
          </div>
          <EffectPanel
            inPoint={state.selection.in}
            outPoint={state.selection.out}
            disabled={!hasAudio || isJumping}
            onApplyEffect={handleApplyEffect}
          />
        </main>

        <aside className="w-[300px] shrink-0">
          <HistoryPanel
            history={historyEntries}
            historyIndex={currentIndex(state)}
            isJumping={isJumping}
            onUndo={() => transitionTo(requestUndo)}
            onRedo={() => transitionTo(requestRedo)}
            onJumpToHistory={(index) => transitionTo((s) => jumpTo(s, index))}
          />
        </aside>
      </div>
    </div>
  )
}
