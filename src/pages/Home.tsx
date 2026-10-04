import { useCallback, useRef, useState } from 'react'
import { Upload, Download } from 'lucide-react'
import WaveformEditor from '@/components/WaveformEditor'
import EffectPanel from '@/components/EffectPanel'
import HistoryPanel from '@/components/HistoryPanel'
import { useEditorStore } from '@/store/useEditorStore'
import type { EffectParams, EffectType } from '@/lib/editorEngine'

async function encodeWav(samples: Float32Array, sampleRate: number): Promise<Blob> {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export default function Home() {
  const {
    hasAudio,
    fileName,
    duration,
    selection,
    history,
    historyIndex,
    jumpInProgress,
    processedSamples,
    loadFromBuffer,
    setInPoint,
    setOutPoint,
    applyEffect,
    undo,
    redo,
    jumpTo,
    exportSamples,
  } = useEditorStore()

  const [zoomLevel, setZoomLevel] = useState(1)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      const arrayBuffer = await file.arrayBuffer()
      const audioContext = new AudioContext()
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
        const samples = new Float32Array(audioBuffer.getChannelData(0))
        loadFromBuffer(file.name, samples, audioBuffer.sampleRate)
      } finally {
        audioContext.close()
      }
    },
    [loadFromBuffer],
  )

  const handleApplyEffect = useCallback(
    (type: EffectType, params: EffectParams) => {
      applyEffect(type, params)
    },
    [applyEffect],
  )

  const handleExport = useCallback(async () => {
    const data = exportSamples()
    if (!data) return
    setExporting(true)
    try {
      const blob = await encodeWav(data.samples, data.sampleRate)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${fileName ?? 'podcast'}-edited.wav`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [exportSamples, fileName])

  return (
    <div className="flex h-screen w-full flex-col" style={{ backgroundColor: '#1a1a2e', color: '#e0e0e0' }}>
      <header className="flex items-center justify-between border-b border-gray-700 px-6 py-3">
        <h1 className="text-lg font-bold">播客工作台</h1>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium hover:bg-cyan-600"
          >
            <Upload className="h-4 w-4" />
            上传音频
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={!hasAudio || exporting || jumpInProgress}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exporting ? '导出中…' : '导出'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        <main className="flex flex-1 flex-col gap-4 overflow-hidden">
          {hasAudio && processedSamples ? (
            <>
              <div className="min-h-0 flex-1">
                <WaveformEditor
                  audioData={processedSamples}
                  inPoint={selection.inPoint}
                  outPoint={selection.outPoint}
                  zoomLevel={zoomLevel}
                  duration={duration}
                  onInPointChange={setInPoint}
                  onOutPointChange={setOutPoint}
                  onZoomLevelChange={setZoomLevel}
                />
              </div>
              <p className="text-xs text-gray-500">
                {fileName} · 时长 {duration.toFixed(2)}s · 选区 {selection.inPoint.toFixed(2)}s -{' '}
                {selection.outPoint.toFixed(2)}s
              </p>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-600 text-gray-500">
              点击右上角「上传音频」开始编辑
            </div>
          )}
        </main>

        <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-hidden">
          <EffectPanel
            inPoint={selection.inPoint}
            outPoint={selection.outPoint}
            disabled={!hasAudio || jumpInProgress}
            onApplyEffect={handleApplyEffect}
          />
          <div className="min-h-0 flex-1">
            <HistoryPanel
              history={history}
              historyIndex={historyIndex}
              isJumping={jumpInProgress}
              onUndo={undo}
              onRedo={redo}
              onJumpToHistory={jumpTo}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
