import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trophy, X, Check } from 'lucide-react'
import { habitDB, habitCheckDB } from '../services/dbService'
import type { Habit, HabitCheck } from '../types'

interface HabitCalendarProps {
  onAddHabit: () => void
}

export default function HabitCalendar({ onAddHabit }: HabitCalendarProps) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [habitChecks, setHabitChecks] = useState<HabitCheck[]>([])
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [habitsData, checksData] = await Promise.all([
      habitDB.getAll(),
      habitCheckDB.getAll()
    ])
    setHabits(habitsData)
    setHabitChecks(checksData)
    if (habitsData.length > 0 && !selectedHabit) {
      setSelectedHabit(habitsData[0].id)
    }
  }

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startDay = firstDay.getDay()
    const daysInMonth = lastDay.getDate()

    const days: (Date | null)[] = []
    for (let i = 0; i < startDay; i++) {
      days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i))
    }
    return days
  }, [currentMonth])

  const getCheckStatus = (date: Date | null) => {
    if (!date || !selectedHabit) return null
    const dateStr = date.toISOString().split('T')[0]
    const check = habitChecks.find(
      hc => hc.habitId === selectedHabit && hc.date === dateStr
    )
    return check ? check.completed : null
  }

  const isFuture = (date: Date | null) => {
    if (!date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date > today
  }

  const isToday = (date: Date | null) => {
    if (!date) return false
    return date.toDateString() === new Date().toDateString()
  }

  const toggleCheck = async (date: Date) => {
    if (!selectedHabit || isFuture(date)) return

    const dateStr = date.toISOString().split('T')[0]
    const existing = habitChecks.find(
      hc => hc.habitId === selectedHabit && hc.date === dateStr
    )
    const newCompleted = !existing?.completed

    const check: HabitCheck = {
      habitId: selectedHabit,
      date: dateStr,
      completed: newCompleted
    }

    await habitCheckDB.set(check)

    setHabitChecks(prev => {
      const filtered = prev.filter(
        hc => !(hc.habitId === selectedHabit && hc.date === dateStr)
      )
      return [...filtered, check]
    })
  }

  const calculateHabitStreak = (habitId: string, checks: HabitCheck[]): number => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let count = 0
    let current = new Date(today)

    while (true) {
      const dateStr = current.toISOString().split('T')[0]
      const check = checks.find(
        hc => hc.habitId === habitId && hc.date === dateStr && hc.completed
      )
      if (check) {
        count++
        current.setDate(current.getDate() - 1)
      } else {
        break
      }
    }

    return count
  }

  const streak = useMemo(() => {
    if (!selectedHabit) return 0
    return calculateHabitStreak(selectedHabit, habitChecks)
  }, [selectedHabit, habitChecks])

  const habitStreaks = useMemo(() => {
    const streaks: Record<string, number> = {}
    habits.forEach(habit => {
      streaks[habit.id] = calculateHabitStreak(habit.id, habitChecks)
    })
    return streaks
  }, [habits, habitChecks])

  const currentHabit = habits.find(h => h.id === selectedHabit)

  const weekDays = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-800">习惯打卡</h3>
        <button
          onClick={onAddHabit}
          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg 
            transition-all duration-300 hover:scale-105 active:scale-95"
        >
          <Plus size={20} />
        </button>
      </div>

      {habits.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {habits.map(habit => (
            <button
              key={habit.id}
              onClick={() => setSelectedHabit(habit.id)}
              className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap 
                transition-all duration-300 flex items-center gap-1.5
                ${selectedHabit === habit.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              {habit.icon && <span>{habit.icon}</span>}
              <span className="truncate max-w-20">{habit.name}</span>
              {habitStreaks[habit.id] >= 7 && (
                <Trophy 
                  size={14} 
                  className={selectedHabit === habit.id ? 'text-yellow-300' : 'text-amber-500'} 
                />
              )}
            </button>
          ))}
        </div>
      )}

      {currentHabit && (
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 rounded-xl mb-4">
          <div className="flex items-center gap-2 mb-3">
            {currentHabit.icon && <span className="text-xl">{currentHabit.icon}</span>}
            <h4 className="font-bold text-lg">{currentHabit.name}</h4>
            {streak >= 7 && (
              <Trophy size={16} className="text-yellow-300" />
            )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">连续打卡</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold">{streak}</span>
                <span className="text-blue-100 mb-1">天</span>
                {streak >= 7 && (
                  <Trophy className="text-yellow-300 ml-2" size={28} />
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-blue-100 text-sm">本月完成</p>
              <p className="text-2xl font-bold">
                {habitChecks.filter(
                  hc =>
                    hc.habitId === selectedHabit &&
                    hc.completed &&
                    new Date(hc.date).getMonth() === currentMonth.getMonth() &&
                    new Date(hc.date).getFullYear() === currentMonth.getFullYear()
                ).length}
                <span className="text-base text-blue-100 ml-1">天</span>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-300"
        >
          <ChevronLeft size={20} className="text-gray-600" />
        </button>
        <h4 className="font-semibold text-gray-800">
          {currentMonth.getFullYear()}年{currentMonth.getMonth() + 1}月
        </h4>
        <button
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-300"
        >
          <ChevronRight size={20} className="text-gray-600" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map(day => (
          <div key={day} className="text-center text-xs text-gray-400 py-2 font-medium">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 flex-1">
        {calendarDays.map((date, index) => {
          const status = getCheckStatus(date)
          const future = isFuture(date)
          const today = isToday(date)

          return (
            <div
              key={index}
              onClick={() => date && !future && toggleCheck(date)}
              className={`aspect-square flex items-center justify-center rounded-lg text-sm
                transition-all duration-200 cursor-pointer relative
                ${!date ? 'invisible' : ''}
                ${date && !future
                  ? status
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 active:scale-90'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 active:scale-90'
                  : ''
                }
                ${future ? 'bg-gray-50 text-gray-300 cursor-not-allowed' : ''}
                ${today ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
                ${date && !future && !status ? 'hover:bg-red-50' : ''}
              `}
            >
              {date && (
                <>
                  {status ? (
                    <Check size={18} className="text-green-600" strokeWidth={3} />
                  ) : future ? (
                    <span className="text-gray-300">{date.getDate()}</span>
                  ) : (
                    <X size={16} className="text-gray-400" strokeWidth={2} />
                  )}
                  {today && (
                    <span className="absolute -bottom-0.5 w-1 h-1 bg-blue-500 rounded-full"></span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-green-100 rounded flex items-center justify-center">
            <Check size={12} className="text-green-600" strokeWidth={3} />
          </div>
          <span>已完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-gray-50 rounded flex items-center justify-center">
            <X size={10} className="text-gray-400" strokeWidth={2} />
          </div>
          <span>未完成</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-gray-50 rounded flex items-center justify-center">
            <span className="text-gray-300 text-[10px]">-</span>
          </div>
          <span>未来日期</span>
        </div>
      </div>

      {habits.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-400">
          <div className="text-5xl mb-3">🎯</div>
          <p className="text-base">还没有习惯</p>
          <button
            onClick={onAddHabit}
            className="mt-3 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            添加第一个习惯
          </button>
        </div>
      )}
    </div>
  )
}
