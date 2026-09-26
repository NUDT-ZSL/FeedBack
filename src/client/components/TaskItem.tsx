import { memo } from 'react'
import { Trash2, Clock, Bell } from 'lucide-react'
import type { Task } from '../types'
import { PRIORITY_LABELS, CATEGORY_LABELS } from '../types'

interface TaskItemProps {
  task: Task
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
}

const priorityColors = {
  high: 'bg-red-500 text-white',
  medium: 'bg-yellow-500 text-white',
  low: 'bg-green-500 text-white'
}

const TaskItem = memo(function TaskItem({ task, onToggle, onDelete, onEdit }: TaskItemProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const isTomorrow = new Date(now.getTime() + 86400000).toDateString() === date.toDateString()

    if (isToday) return '今天'
    if (isTomorrow) return '明天'
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <div
      className={`group flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm border border-gray-100 
        transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 cursor-pointer
        ${task.completed ? 'opacity-60 bg-gray-50' : ''}`}
      onClick={() => onEdit(task)}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={(e) => {
          e.stopPropagation()
          onToggle(task.id)
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 
          cursor-pointer transition-all duration-300"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3
            className={`font-medium text-gray-800 truncate transition-all duration-300
              ${task.completed ? 'line-through text-gray-500' : ''}`}
          >
            {task.title}
          </h3>
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0
              ${priorityColors[task.priority]}`}
          >
            {PRIORITY_LABELS[task.priority]}优先级
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Clock size={14} />
            {formatDate(task.dueDate)}
          </span>
          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
            {CATEGORY_LABELS[task.category]}
          </span>
          {task.remindMinutes && task.remindMinutes > 0 && (
            <span className="flex items-center gap-1 text-blue-500">
              <Bell size={14} />
              提前{task.remindMinutes}分钟
            </span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(task.id)
        }}
        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg 
          opacity-0 group-hover:opacity-100 transition-all duration-300"
      >
        <Trash2 size={18} />
      </button>
    </div>
  )
})

export default TaskItem
