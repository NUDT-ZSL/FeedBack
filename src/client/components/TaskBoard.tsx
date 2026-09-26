import { useState, useEffect, useMemo } from 'react'
import { Plus, Filter } from 'lucide-react'
import TaskItem from './TaskItem'
import { taskDB } from '../services/dbService'
import type { Task, Priority, Category } from '../types'
import { CATEGORY_LABELS } from '../types'

interface TaskBoardProps {
  selectedCategory: Category | 'all'
  onAddTask: () => void
  onEditTask: (task: Task) => void
}

const priorityWeight: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1
}

export default function TaskBoard({ selectedCategory, onAddTask, onEditTask }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [sortBy, setSortBy] = useState<'priority' | 'dueDate'>('priority')

  useEffect(() => {
    loadTasks()
  }, [selectedCategory])

  const loadTasks = async () => {
    const allTasks = await taskDB.getAll()
    let filtered = allTasks
    if (selectedCategory !== 'all') {
      filtered = allTasks.filter(t => t.category === selectedCategory)
    }
    setTasks(filtered)
  }

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      if (sortBy === 'priority') {
        const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
        if (priorityDiff !== 0) return priorityDiff
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      } else {
        const dateDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        if (dateDiff !== 0) return dateDiff
        return priorityWeight[b.priority] - priorityWeight[a.priority]
      }
    })
  }, [tasks, sortBy])

  const toggleTask = async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const updated = await taskDB.update(id, { completed: !task.completed })
    if (updated) {
      setTasks(tasks.map(t => (t.id === id ? updated : t)))
    }
  }

  const deleteTask = async (id: string) => {
    await taskDB.delete(id)
    setTasks(tasks.filter(t => t.id !== id))
  }

  const todayCount = tasks.filter(t => {
    const today = new Date().toDateString()
    return new Date(t.dueDate).toDateString() === today && !t.completed
  }).length

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {selectedCategory === 'all' ? '所有任务' : CATEGORY_LABELS[selectedCategory]}
          </h2>
          <p className="text-sm text-gray-500 mt-1">今日待办：{todayCount} 项</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSortBy(sortBy === 'priority' ? 'dueDate' : 'priority')}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 
              hover:bg-gray-100 rounded-lg transition-colors duration-300"
          >
            <Filter size={16} />
            {sortBy === 'priority' ? '按优先级' : '按截止日'}
          </button>
          <button
            onClick={onAddTask}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white 
              rounded-lg hover:bg-blue-700 transition-all duration-300 
              hover:shadow-lg active:scale-95"
          >
            <Plus size={18} />
            添加任务
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {sortedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <div className="text-6xl mb-4">📝</div>
            <p className="text-lg">暂无任务</p>
            <p className="text-sm mt-1">点击上方按钮添加新任务</p>
          </div>
        ) : (
          sortedTasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onEdit={onEditTask}
            />
          ))
        )}
      </div>
    </div>
  )
}
