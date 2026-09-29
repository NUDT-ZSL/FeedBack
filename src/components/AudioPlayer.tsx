import { useEffect, useRef, useState } from 'react'
import type { AudioEngine, EngineSnapshot } from '../core/audioEngine'
import type { VULevels } from '../core/vuMeter'
import { Upload, Play, Pause, Square, Volume2 } from 'lucide-react'

interface AudioPlayerProps {
  engine: AudioEngine
}

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const getVUColor = (level: number): string => {
  if (level <= 0.5) return '#22c55e'
  if (level <= 0.8) return '#f97316'
  return '#ef4444'
}

export default function AudioPlayer({ engine }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [snap, setSnap] = useState<EngineSnapshot>(() => engine.getSnapshot())
  const [vuLevels, setVuLevels] = useState<VULevels>({ left: 0, right: 0 })

  useEffect(() => engine.subscribe(() => setSnap(engine.getSnapshot())), [engine])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    engine.attachElement(audio)
    return () => engine.detachElement()
  }, [engine])

  // One interval for the component's whole lifetime. The zeroing policy
  // (paused / seeking / no analyzer) lives in the engine, so play, pause
  // and seek drags never restart this timer.
  useEffect(() => {
    const id = window.setInterval(() => {
      setVuLevels(engine.getVULevels())
    }, 1000 / 30)
    return () => window.clearInterval(id)
  }, [engine])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && engine.getSnapshot().fileName) {
        e.preventDefault()
        void engine.togglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Allow re-selecting the same file later.
    e.target.value = ''
    if (!file) return
    try {
      await engine.loadFile(file)
    } catch (err) {
      console.error('Playback failed:', err)
    }
  }

  const handlePlayPause = () => {
    void engine.togglePlay()
  }

  const handleStop = () => {
    engine.stop()
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    engine.setVolume(parseFloat(e.target.value))
  }

  const handleSeekStart = () => {
    engine.beginSeek()
  }

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    engine.previewSeek(parseFloat(e.target.value))
  }

  const handleSeekEnd = (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.MouseEvent<HTMLInputElement>
      | React.TouchEvent<HTMLInputElement>,
  ) => {
    engine.endSeek(parseFloat((e.target as HTMLInputElement).value))
  }

  const { fileName, isPlaying, isSeeking, currentTime, duration, volume } = snap
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="w-full space-y-4">
      <audio ref={audioRef} />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mp3,audio/wav,audio/mpeg,audio/x-wav,.mp3,.wav"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          onClick={handleUploadClick}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-white transition-all duration-200 hover:bg-white/10 active:scale-90"
          style={{ minHeight: '44px' }}
        >
          <Upload size={20} />
          <span className="text-sm sm:text-base">上传</span>
        </button>

        <button
          onClick={handlePlayPause}
          disabled={!fileName}
          className="flex items-center justify-center px-4 py-2.5 rounded-lg text-white transition-all duration-200 hover:bg-white/10 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100"
          style={{ minHeight: '44px' }}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <button
          onClick={handleStop}
          disabled={!fileName}
          className="flex items-center justify-center px-4 py-2.5 rounded-lg text-white transition-all duration-200 hover:bg-white/10 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100"
          style={{ minHeight: '44px' }}
        >
          <Square size={18} />
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <Volume2 size={18} className="text-white/70" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolumeChange}
            className="w-20 sm:w-28 accent-white/80 cursor-pointer"
          />
          <span className="text-white/70 text-xs sm:text-sm w-8">{Math.round(volume * 100)}%</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-white/50 mb-1">L</div>
            <div className="h-2 sm:h-3 bg-black/40 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${Math.min(100, vuLevels.left * 100)}%`,
                  backgroundColor: getVUColor(vuLevels.left),
                }}
              />
            </div>
          </div>
          <div>
            <div className="text-xs text-white/50 mb-1 text-right">R</div>
            <div className="h-2 sm:h-3 bg-black/40 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-75 ml-auto"
                style={{
                  width: `${Math.min(100, vuLevels.right * 100)}%`,
                  backgroundColor: getVUColor(vuLevels.right),
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs sm:text-sm text-white/70">
          <span className="truncate max-w-[60%]">{fileName || '未选择文件'}</span>
          <span className="font-mono tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="relative pt-1">
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
              style={{ width: `${progressPercent}%`, transitionDuration: isSeeking ? '0ms' : '100ms' }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onMouseDown={handleSeekStart}
            onChange={handleSeekChange}
            onMouseUp={handleSeekEnd}
            onTouchStart={handleSeekStart}
            onTouchEnd={handleSeekEnd}
            disabled={!fileName}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  )
}
