import { useState, useMemo } from 'react'
import WorkCard from './WorkCard'
import { STYLE_TAGS, getWorks } from '../data/mockData'
import { TrendingUp, Clock } from 'lucide-react'

interface WorksListProps {
  selectedStyle?: string
  sortBy?: 'time' | 'popularity'
}

export default function WorksList({ selectedStyle, sortBy: propSortBy }: WorksListProps) {
  const [activeStyle, setActiveStyle] = useState<string>(selectedStyle || '全部')
  const [sortBy, setSortBy] = useState<'time' | 'popularity'>(propSortBy || 'time')

  const works = useMemo(() => {
    let result = getWorks()

    if (activeStyle !== '全部') {
      result = result.filter(w => w.styles.includes(activeStyle))
    }

    if (sortBy === 'popularity') {
      result = [...result].sort((a, b) => b.giftValue - a.giftValue)
    } else {
      result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }

    return result
  }, [activeStyle, sortBy])

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">发现好音乐</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortBy('time')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-300 ${
                sortBy === 'time'
                  ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Clock size={14} />
              <span>最新</span>
            </button>
            <button
              onClick={() => setSortBy('popularity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-300 ${
                sortBy === 'popularity'
                  ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <TrendingUp size={14} />
              <span>最热</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {['全部', ...STYLE_TAGS].map((style) => (
              <button
                key={style}
                onClick={() => setActiveStyle(style)}
                className="relative flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 hover:scale-105"
                style={{
                  backgroundColor: activeStyle === style ? 'rgba(233, 69, 96, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  color: activeStyle === style ? '#E94560' : 'rgba(255, 255, 255, 0.7)',
                  border: activeStyle === style ? '1px solid rgba(233, 69, 96, 0.5)' : '1px solid transparent',
                  transform: activeStyle === style ? 'scale(1.05)' : 'scale(1)',
                  transition: 'all 0.3s ease',
                }}
              >
                {style}
                {activeStyle === style && (
                  <span
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-pink-500 rounded-full"
                    style={{
                      animation: 'slideInUnderline 0.3s ease forwards',
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {works.map((work, index) => (
          <div
            key={work.id}
            style={{
              animation: `slideInUp 0.5s ease ${index * 0.05}s both`,
            }}
          >
            <WorkCard work={work} />
          </div>
        ))}
      </div>

      {works.length === 0 && (
        <div className="text-center py-20">
          <p className="text-white/50">暂无相关作品</p>
        </div>
      )}

      <style>{`
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideInUnderline {
          from {
            width: 0;
          }
          to {
            width: 24px;
          }
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
