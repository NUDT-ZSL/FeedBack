import { useState } from 'react'
import { Clock, ExternalLink, CheckCircle, Circle, PlayCircle } from 'lucide-react'
import type { TimelineItem, LearningStatus, Resource } from '../store'
import { useAppStore } from '../store'
import { cn } from '@/lib/utils'

interface TimelineCardProps {
  item: TimelineItem
  isFirst?: boolean
  isLast?: boolean
  onResourceClick?: (resourceId: string) => void
  resource?: Resource
}

const statusConfig: Record<
  LearningStatus,
  { label: string; icon: typeof Circle; color: string; bgColor: string }
> = {
  not_started: {
    label: '未学习',
    icon: Circle,
    color: 'text-gray-400',
    bgColor: 'bg-gray-100',
  },
  in_progress: {
    label: '学习中',
    icon: PlayCircle,
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
  },
  completed: {
    label: '已完成',
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-100',
  },
}

const statusOrder: LearningStatus[] = ['not_started', 'in_progress', 'completed']

export default function TimelineCard({
  item,
  isFirst = false,
  isLast = false,
  onResourceClick,
  resource,
}: TimelineCardProps) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const updateLearningStatus = useAppStore((state) => state.updateLearningStatus)

  const currentStatus = statusConfig[item.status]
  const StatusIcon = currentStatus.icon

  const cycleStatus = () => {
    setIsTransitioning(true)
    const currentIndex = statusOrder.indexOf(item.status)
    const nextIndex = (currentIndex + 1) % statusOrder.length
    const nextStatus = statusOrder[nextIndex]
    
    setTimeout(() => {
      updateLearningStatus(item.id, nextStatus)
      setTimeout(() => {
        setIsTransitioning(false)
      }, 200)
    }, 50)
  }

  return (
    <div className="relative flex gap-4">
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            'w-3 h-3 rounded-full border-2 transition-all duration-200',
            item.status === 'completed'
              ? 'bg-green-500 border-green-500'
              : item.status === 'in_progress'
              ? 'bg-blue-500 border-blue-500'
              : 'bg-white border-gray-300'
          )}
        />
        {!isLast && (
          <div
            className={cn(
              'w-0.5 flex-1 mt-1 transition-colors duration-500',
              item.status === 'completed' ? 'bg-green-300' : 'bg-gray-200'
            )}
          />
        )}
      </div>

      <div
        className={cn(
          'flex-1 mb-6 p-5 bg-white rounded-xl shadow-sm border border-gray-100',
          'hover:shadow-md transition-shadow duration-200',
          isFirst && 'mt-0'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">{item.skillName}</h3>

            <div className="flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{item.estimatedDuration}</span>
              </div>
              {resource && (
                <button
                  onClick={() => onResourceClick?.(item.resourceId)}
                  className="flex items-center gap-1.5 text-blue-500 hover:text-blue-600 transition-colors duration-200"
                >
                  <span>查看资源</span>
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <button
            onClick={cycleStatus}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm',
              'transition-all duration-200 status-transition',
              isTransitioning && 'opacity-0 scale-95',
              currentStatus.bgColor,
              currentStatus.color,
              'hover:opacity-90 active:scale-95'
            )}
          >
            <StatusIcon className="w-4 h-4" />
            <span>{currentStatus.label}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
