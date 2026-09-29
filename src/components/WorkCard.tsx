import { Play, Eye, Gift } from 'lucide-react'
import type { Work } from '../data/mockData'
import { usePlayerStore } from '../store/usePlayerStore'
import { useNavigate } from 'react-router-dom'
import { incrementPlayCount } from '../data/mockData'

interface WorkCardProps {
  work: Work
}

export default function WorkCard({ work }: WorkCardProps) {
  const navigate = useNavigate()
  const { setCurrentWork, isPlaying, currentWork } = usePlayerStore()

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (currentWork?.id !== work.id) {
      setCurrentWork(work)
      incrementPlayCount(work.id)
    } else {
      usePlayerStore.getState().togglePlay()
    }
  }

  const handleCardClick = () => {
    navigate(`/work/${work.id}`)
  }

  const isCurrentPlaying = currentWork?.id === work.id && isPlaying

  return (
    <div
      onClick={handleCardClick}
      className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-400 hover:shadow-[0_0_30px_rgba(67,97,238,0.4)] hover:-translate-y-1"
      style={{ transition: 'box-shadow 0.4s ease, transform 0.3s ease' }}
    >
      <div
        className="aspect-square relative overflow-hidden"
        style={{ background: work.coverGradient }}
      >
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300" />
        
        <button
          onClick={handlePlay}
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300"
        >
          <div className={`w-16 h-16 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-xl transition-transform duration-300 hover:scale-110 ${
            isCurrentPlaying ? 'opacity-100 scale-110' : ''
          }`} style={{ opacity: isCurrentPlaying ? 1 : undefined }}>
            <Play size={24} className="text-gray-800 ml-1" fill="currentColor" />
          </div>
        </button>

        <div className="absolute top-3 right-3 flex gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm text-xs text-white/90">
            <Eye size={12} />
            <span>{work.playCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-sm text-xs text-white/90">
            <Gift size={12} />
            <span>{work.giftCount}</span>
          </div>
        </div>
      </div>

      <div className="p-4 bg-white/5 backdrop-blur-sm border border-white/10 border-t-0 rounded-b-2xl">
        <h3 className="font-semibold text-white truncate mb-1">{work.title}</h3>
        <p className="text-sm text-white/60 mb-2">{work.artistName}</p>
        <div className="flex flex-wrap gap-1.5">
          {work.styles.slice(0, 3).map((style) => (
            <span
              key={style}
              className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-white/70"
            >
              {style}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
