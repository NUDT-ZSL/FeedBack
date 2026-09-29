import { useEffect, useRef } from 'react'
import AudioPlayer from './components/AudioPlayer'
import Visualizer from './components/Visualizer'
import { AudioEngine } from './core/audioEngine'

export default function App() {
  // The engine lives outside React state: analyzer lifecycle, playback and
  // seek state, and render-loop control never trigger re-renders or effect
  // rebuilds. Components only subscribe to snapshots.
  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current = new AudioEngine()
  }
  const engine = engineRef.current

  useEffect(() => {
    return () => engine.dispose()
  }, [engine])

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
          <AudioPlayer engine={engine} />
          <Visualizer engine={engine} />
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          支持 MP3 / WAV 格式 · 空格键播放/暂停
        </p>
      </div>
    </div>
  )
}
