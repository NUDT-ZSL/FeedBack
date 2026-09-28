import { useEffect, useState } from 'react'
import { X, Star } from 'lucide-react'
import type { Resource } from '../store'
import { useAppStore } from '../store'
import { cn } from '@/lib/utils'

interface ResourceModalProps {
  resource: Resource | null
  isOpen: boolean
  onClose: () => void
}

export default function ResourceModal({ resource, isOpen, onClose }: ResourceModalProps) {
  const [isVisible, setIsVisible] = useState(false)
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isVisible && !isOpen) return null

  const renderStars = (count: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={cn(
          'w-5 h-5',
          i < count ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
        )}
      />
    ))
  }

  const typeLabels: Record<string, string> = {
    video: '视频',
    article: '文章',
    book: '书籍',
    course: '课程',
    podcast: '播客',
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center',
        isOpen ? 'opacity-100' : 'opacity-0',
        'transition-opacity duration-300'
      )}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative w-full max-w-2xl bg-white rounded-t-2xl shadow-2xl overflow-hidden',
          isOpen ? 'translate-y-0' : 'translate-y-full',
          'transition-transform duration-300 ease-out'
        )}
      >
        {resource && (
          <>
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 truncate pr-4">
                {resource.name}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleFavorite(resource.id)}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors duration-200"
                >
                  <Star
                    className={cn(
                      'w-6 h-6 transition-all duration-200',
                      resource.isFavorite
                        ? 'fill-yellow-400 text-yellow-400 scale-110'
                        : 'text-gray-400 hover:text-yellow-400'
                    )}
                  />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-gray-100 transition-colors duration-200"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="flex flex-wrap gap-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                  {typeLabels[resource.type] || resource.type}
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                  时长: {resource.duration}
                </span>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-600">难度</p>
                <div className="flex gap-1">{renderStars(resource.difficulty)}</div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-600">用户评价</p>
                <div className="flex items-center gap-2">
                  <div className="flex">{renderStars(Math.round(resource.rating))}</div>
                  <span className="text-lg font-semibold text-gray-900">
                    {resource.rating.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-600">摘要</p>
                <p className="text-gray-700 leading-relaxed">{resource.summary}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
