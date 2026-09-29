import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Eye, Gift } from 'lucide-react'
import { getWorkById, hashUsernameToColor, getInitials } from '../data/mockData'
import type { Work } from '../data/mockData'
import AudioVisualizer from '../components/AudioVisualizer'
import CommentSection from '../components/CommentSection'
import GiftButton from '../components/GiftButton'
import { usePlayerStore } from '../store/usePlayerStore'
import { incrementPlayCount } from '../data/mockData'

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [work, setWork] = useState<Work | null>(null)
  const { currentWork, isPlaying, setCurrentWork, togglePlay } = usePlayerStore()
  const isCurrentPlaying = currentWork?.id === work?.id && isPlaying

  useEffect(() => {
    if (id) {
      const foundWork = getWorkById(id)
      if (foundWork) {
        setWork(foundWork)
      }
    }
  }, [id])

  const handlePlay = () => {
    if (!work) return
    if (currentWork?.id !== work.id) {
      setCurrentWork(work)
      incrementPlayCount(work.id)
      setWork({ ...work, playCount: work.playCount + 1 })
    } else {
      togglePlay()
    }
  }

  const handleGiftSent = (updatedWork: Work) => {
    setWork({ ...updatedWork })
  }

  if (!work) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-white/50">作品不存在</p>
      </div>
    )
  }

  return (
    <div className="animate-fadeIn">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-white/70 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        <span>返回</span>
      </button>

      <div
        className="relative rounded-3xl overflow-hidden mb-6"
        style={{ background: work.coverGradient }}
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative p-8 md:p-12">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <button
              onClick={handlePlay}
              className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all duration-300 hover:scale-110 shadow-2xl"
            >
              {isCurrentPlaying ? (
                <Pause size={32} className="text-white ml-1" fill="currentColor" />
              ) : (
                <Play size={32} className="text-white ml-2" fill="currentColor" />
              )}
            </button>

            <div className="flex-1 text-center md:text-left">
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">{work.title}</h1>
              <div className="flex items-center justify-center md:justify-start gap-2 text-white/80 mb-4">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                  style={{ backgroundColor: hashUsernameToColor(work.artistName) }}
                >
                  {getInitials(work.artistName)}
                </div>
                <span>{work.artistName}</span>
              </div>
              <div className="flex items-center justify-center md:justify-start gap-4 text-white/70 text-sm">
                <span className="flex items-center gap-1">
                  <Eye size={16} />
                  {work.playCount.toLocaleString()} 次播放
                </span>
                <span className="flex items-center gap-1">
                  <Gift size={16} />
                  {work.giftCount} 个礼物
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <AudioVisualizer isPlaying={isCurrentPlaying} barCount={256} height={180} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <h3 className="text-lg font-semibold mb-3">作品简介</h3>
            <p className="text-white/70 leading-relaxed">{work.description}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {work.styles.map((style) => (
                <span
                  key={style}
                  className="px-3 py-1 text-sm rounded-full bg-pink-500/20 text-pink-400 border border-pink-500/30"
                >
                  {style}
                </span>
              ))}
            </div>
          </div>

          <CommentSection workId={work.id} />
        </div>

        <div className="space-y-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <h3 className="text-lg font-semibold mb-4">送礼物</h3>
            <GiftButton workId={work.id} onGiftSent={handleGiftSent} />
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-sm text-white/60 flex items-center justify-between">
                <span>累计礼物价值</span>
                <span className="text-pink-400 font-semibold">¥{work.giftValue}</span>
              </p>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
            <h3 className="text-lg font-semibold mb-4">音乐人</h3>
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold"
                style={{ backgroundColor: hashUsernameToColor(work.artistName) }}
              >
                {getInitials(work.artistName)}
              </div>
              <div>
                <p className="font-medium">{work.artistName}</p>
                <p className="text-sm text-white/50">音乐人</p>
              </div>
            </div>
            <button className="w-full mt-4 py-2 px-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm font-medium hover:shadow-[0_0_20px_rgba(233,69,96,0.4)] transition-all duration-300">
              + 关注
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
