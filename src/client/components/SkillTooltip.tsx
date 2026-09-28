import { useState, useEffect, useRef } from 'react'
import { BookOpen, ExternalLink } from 'lucide-react'
import type { Skill, Resource } from '../store'
import ProficiencySlider from './ProficiencySlider'
import { cn } from '@/lib/utils'

interface SkillTooltipProps {
  skill: Skill
  position?: { x: number; y: number }
  isVisible: boolean
  onResourceClick?: (resource: Resource) => void
}

export default function SkillTooltip({
  skill,
  position = { x: 0, y: 0 },
  isVisible,
  onResourceClick,
}: SkillTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  useEffect(() => {
    if (tooltipRef.current && isVisible) {
      const rect = tooltipRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let x = position.x + 16
      let y = position.y + 16

      if (x + rect.width > viewportWidth - 16) {
        x = position.x - rect.width - 16
      }
      if (y + rect.height > viewportHeight - 16) {
        y = position.y - rect.height - 16
      }

      setAdjustedPosition({ x: Math.max(16, x), y: Math.max(16, y) })
    }
  }, [position, isVisible])

  const getProficiencyColor = (proficiency: number) => {
    const ratio = proficiency / 100
    const r = Math.round(255 * (1 - ratio))
    const g = Math.round(255 * ratio)
    return `rgb(${r}, ${g}, 0)`
  }

  if (!isVisible) return null

  return (
    <div
      ref={tooltipRef}
      className={cn(
        'fixed z-50 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden',
        'animate-in fade-in zoom-in-95 duration-200'
      )}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div className="p-5 space-y-5">
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-gray-900">{skill.name}</h3>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-600">熟练度</span>
              <span
                className="text-sm font-bold"
                style={{ color: getProficiencyColor(skill.proficiency) }}
              >
                {skill.proficiency}%
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${skill.proficiency}%`,
                  background: `linear-gradient(to right, #ef4444, #22c55e)`,
                  backgroundSize: '100% 100%',
                }}
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <ProficiencySlider
            skillId={skill.id}
            value={skill.proficiency}
            onChange={() => {}}
          />
        </div>

        {skill.resources.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-gray-700">推荐学习资源</span>
            </div>
            <div className="space-y-2">
              {skill.resources.slice(0, 3).map((resource) => (
                <button
                  key={resource.id}
                  onClick={() => onResourceClick?.(resource)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-blue-50 transition-colors duration-200 group text-left"
                >
                  <span className="text-sm text-gray-800 truncate pr-2">
                    {resource.name}
                  </span>
                  <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors duration-200 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
