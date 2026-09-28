import { useState } from 'react'
import AudioPlayer from './components/AudioPlayer'
import Visualizer from './components/Visualizer'
import { AudioAnalyzer } from './utils/audioAnalyzer'

export default function App() {
  const [analyzer, setAnalyzer] = useState<AudioAnalyzer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6">
      <div
        className="w-full max-w-4xl rounded-2xl p-5 sm:p-8"
        style={{
          backgroundColor: '#16213e',
          boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.3)',
        }}
      >
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-6 text-center tracking-wide">
          音乐可视化播放器
        </h1>

        <div className="space-y-5 sm:space-y-6">
          <AudioPlayer
            onAudioContextReady={setAnalyzer}
            onPlayingChange={setIsPlaying}
            onSeekingChange={setIsSeeking}
          />

          <Visualizer
            analyzer={analyzer}
            isPlaying={isPlaying}
            isSeeking={isSeeking}
          />
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          支持 MP3 / WAV 格式 · 空格键播放/暂停
        </p>
      </div>
    </div>
  )
}
