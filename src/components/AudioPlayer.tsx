import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioAnalyzer } from '../utils/audioAnalyzer'
import { Upload, Play, Pause, Square, Volume2 } from 'lucide-react'

interface AudioPlayerProps {
  onAudioContextReady: (analyzer: AudioAnalyzer | null) => void
  onPlayingChange: (isPlaying: boolean) => void
  onSeekingChange: (isSeeking: boolean) => void
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

export default function AudioPlayer({ onAudioContextReady, onPlayingChange, onSeekingChange }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const analyzerRef = useRef<AudioAnalyzer | null>(null)
  const vuTimerRef = useRef<number>(0)

  const [fileName, setFileName] = useState<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [isSeeking, setIsSeeking] = useState(false)
  const [vuLevels, setVuLevels] = useState({ left: 0, right: 0 })

  const updateIsPlaying = useCallback((playing: boolean) => {
    setIsPlaying(playing)
    onPlayingChange(playing)
  }, [onPlayingChange])

  const updateIsSeeking = useCallback((seeking: boolean) => {
    setIsSeeking(seeking)
    onSeekingChange(seeking)
  }, [onSeekingChange])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!audioRef.current) return

    const url = URL.createObjectURL(file)
    audioRef.current.src = url
    setFileName(file.name)
    setCurrentTime(0)
    setDuration(0)

    if (!analyzerRef.current) {
      analyzerRef.current = new AudioAnalyzer()
    }

    try {
      analyzerRef.current.connect(audioRef.current)
      onAudioContextReady(analyzerRef.current)
      await analyzerRef.current.resume()
      await audioRef.current.play()
    } catch (err) {
      console.error('Playback failed:', err)
    }
  }

  const handlePlayPause = useCallback(async () => {
    if (!audioRef.current || !fileName) return

    try {
      await analyzerRef.current?.resume()
      if (audioRef.current.paused) {
        await audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
    } catch (err) {
      console.error('Playback toggle failed:', err)
    }
  }, [fileName])

  const handleStop = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
  }, [])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
  }

  const handleSeekStart = () => {
    updateIsSeeking(true)
  }

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    setCurrentTime(time)
  }

  const handleSeekEnd = (e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    if (!audioRef.current) return
    const target = e.target as HTMLInputElement
    const time = parseFloat(target.value)
    audioRef.current.currentTime = time
    setCurrentTime(time)
    updateIsSeeking(false)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => setDuration(audio.duration)
    const onTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(audio.currentTime)
      }
    }
    const onPlay = () => updateIsPlaying(true)
    const onPause = () => updateIsPlaying(false)
    const onEnded = () => updateIsPlaying(false)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [isSeeking, updateIsPlaying])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && fileName) {
        e.preventDefault()
        handlePlayPause()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fileName, handlePlayPause])

  useEffect(() => {
    vuTimerRef.current = window.setInterval(() => {
      if (analyzerRef.current && isPlaying && !isSeeking) {
        setVuLevels(analyzerRef.current.getChannelPeaks())
      } else {
        setVuLevels({ left: 0, right: 0 })
      }
    }, 1000 / 30)

    return () => {
      clearInterval(vuTimerRef.current)
    }
  }, [isPlaying, isSeeking])

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
