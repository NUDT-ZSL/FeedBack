import { useState, useEffect } from 'react'
import Modal from './Modal'
import { habitDB } from '../services/dbService'
import type { Habit } from '../types'

interface HabitFormModalProps {
  isOpen: boolean
  onClose: () => void
  habit?: Habit | null
  onSaved?: () => void
}

const ICON_OPTIONS = ['📚', '💪', '🏃', '🧘', '💧', '🍎', '😴', '✍️', '🎯', '💻', '🎵', '🌱']

export default function HabitFormModal({ isOpen, onClose, habit, onSaved }: HabitFormModalProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🎯')

  const isEditing = !!habit

  useEffect(() => {
    if (habit) {
      setName(habit.name)
      setIcon(habit.icon || '🎯')
    } else {
      setName('')
      setIcon('🎯')
    }
  }, [habit, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const habitData = {
      name: name.trim(),
      icon
    }

    if (isEditing && habit) {
      await habitDB.update(habit.id, habitData)
    } else {
      await habitDB.add(habitData)
    }

    onSaved?.()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? '编辑习惯' : '新建习惯'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            习惯名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：每天阅读30分钟"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg 
              focus:ring-2 focus:ring-blue-500 focus:border-transparent 
              transition-all duration-300 outline-none"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            选择图标
          </label>
          <div className="grid grid-cols-6 gap-2">
            {ICON_OPTIONS.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`aspect-square flex items-center justify-center text-2xl 
                  rounded-lg transition-all duration-200
                  ${icon === emoji
                    ? 'bg-blue-100 ring-2 ring-blue-500 scale-110'
                    : 'bg-gray-50 hover:bg-gray-100 hover:scale-105'
                  }`}
              >
                {emoji}
              </button>
            ))}
          </div>
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
            {isEditing ? '保存修改' : '创建习惯'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
