import { useState, useEffect } from 'react'
import { Bell, BellRing, AlertCircle } from 'lucide-react'
import Modal from './Modal'
import { taskDB } from '../services/dbService'
import type { Task, Priority, Category } from '../types'
import { PRIORITY_LABELS, CATEGORY_LABELS, REMIND_OPTIONS } from '../types'

interface TaskFormModalProps {
  isOpen: boolean
  onClose: () => void
  task?: Task | null
  onSaved?: () => void
  notificationPermission?: NotificationPermission
  onRequestPermission?: () => Promise<boolean>
  onTestReminder?: () => void
}

export default function TaskFormModal({ 
  isOpen, 
  onClose, 
  task, 
  onSaved,
  notificationPermission = 'default',
  onRequestPermission,
  onTestReminder
}: TaskFormModalProps) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [category, setCategory] = useState<Category>('work')
  const [remindMinutes, setRemindMinutes] = useState(0)
  const [isRequestingPermission, setIsRequestingPermission] = useState(false)

  const isEditing = !!task

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDueDate(task.dueDate.slice(0, 16))
      setPriority(task.priority)
      setCategory(task.category)
      setRemindMinutes(task.remindMinutes || 0)
    } else {
      setTitle('')
      const now = new Date()
      now.setHours(now.getHours() + 1)
      now.setMinutes(0)
      setDueDate(now.toISOString().slice(0, 16))
      setPriority('medium')
      setCategory('work')
      setRemindMinutes(0)
    }
  }, [task, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    if (remindMinutes > 0 && notificationPermission !== 'granted' && onRequestPermission) {
      setIsRequestingPermission(true)
      const granted = await onRequestPermission()
      setIsRequestingPermission(false)
      if (!granted) {
        setRemindMinutes(0)
      }
    }

    const taskData = {
      title: title.trim(),
      dueDate: new Date(dueDate).toISOString(),
      priority,
      category,
      remindMinutes: remindMinutes || undefined,
      completed: task?.completed || false
    }

    if (isEditing && task) {
      await taskDB.update(task.id, taskData)
    } else {
      await taskDB.add(taskData)
    }

    onSaved?.()
    onClose()
  }

  const handleRequestPermission = async () => {
    if (onRequestPermission) {
      setIsRequestingPermission(true)
      await onRequestPermission()
      setIsRequestingPermission(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? '编辑任务' : '新建任务'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            任务标题
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入任务标题..."
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
              focus:ring-2 focus:ring-blue-500 focus:border-transparent 
              transition-all duration-300 outline-none"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            截止时间
          </label>
          <input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
              focus:ring-2 focus:ring-blue-500 focus:border-transparent 
              transition-all duration-300 outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              优先级
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
                focus:ring-2 focus:ring-blue-500 focus:border-transparent 
                transition-all duration-300 outline-none bg-white"
            >
              {(['high', 'medium', 'low'] as Priority[]).map(p => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}优先级
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              分类
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
                focus:ring-2 focus:ring-blue-500 focus:border-transparent 
                transition-all duration-300 outline-none bg-white"
            >
              {(['work', 'study', 'life'] as Category[]).map(c => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            提醒设置
          </label>
          <select
            value={remindMinutes}
            onChange={(e) => setRemindMinutes(Number(e.target.value))}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
              focus:ring-2 focus:ring-blue-500 focus:border-transparent 
              transition-all duration-300 outline-none bg-white"
          >
            {REMIND_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {remindMinutes > 0 && notificationPermission !== 'granted' && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-amber-700">
                    通知权限未开启，无法接收提醒
                  </p>
                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    disabled={isRequestingPermission || notificationPermission === 'denied'}
                    className="mt-2 text-sm font-medium text-amber-700 hover:text-amber-800 
                      underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
                      transition-all duration-300"
                  >
                    {isRequestingPermission ? '请求中...' : notificationPermission === 'denied' ? '已被拒绝，请在浏览器设置中开启' : '申请通知权限'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {notificationPermission === 'granted' && remindMinutes > 0 && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BellRing size={18} className="text-green-500" />
                  <p className="text-sm text-green-700">
                    提醒功能已开启
                  </p>
                </div>
                {onTestReminder && (
                  <button
                    type="button"
                    onClick={onTestReminder}
                    className="text-sm font-medium text-green-700 hover:text-green-800 
                      underline underline-offset-2 transition-all duration-300"
                  >
                    测试提醒
                  </button>
                )}
              </div>
            </div>
          )}

          {notificationPermission === 'default' && remindMinutes === 0 && (
            <button
              type="button"
              onClick={handleRequestPermission}
              disabled={isRequestingPermission}
              className="mt-2 text-sm text-gray-500 hover:text-gray-700 
                flex items-center gap-1.5 transition-all duration-300"
            >
              <Bell size={14} />
              <span>{isRequestingPermission ? '请求中...' : '预先开启通知权限'}</span>
            </button>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 
              rounded-lg hover:bg-gray-50 transition-all duration-300 font-medium"
          >
            取消
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg 
              hover:bg-blue-700 transition-all duration-300 font-medium
              hover:shadow-lg active:scale-95"
          >
            {isEditing ? '保存修改' : '创建任务'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
