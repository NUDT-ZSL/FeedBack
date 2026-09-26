import { useState, useEffect, useCallback, useRef } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from './components/Sidebar'
import TaskBoard from './components/TaskBoard'
import HabitCalendar from './components/HabitCalendar'
import TaskFormModal from './components/TaskFormModal'
import HabitFormModal from './components/HabitFormModal'
import { taskDB, habitDB, habitCheckDB, exportData, importData, downloadJSON } from './services/dbService'
import type { Task, Category, Habit, ExportData, HabitCheck } from './types'

function App() {
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all')
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [habitModalOpen, setHabitModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [todayTaskCount, setTodayTaskCount] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const reminderTimersRef = useRef<number[]>([])

  useEffect(() => {
    loadStats()
  }, [refreshKey])

  const loadStats = async () => {
    const [tasks, habits, checks] = await Promise.all([
      taskDB.getAll(),
      habitDB.getAll(),
      habitCheckDB.getAll()
    ])

    const today = new Date().toDateString()
    const todayTasks = tasks.filter(
      t => new Date(t.dueDate).toDateString() === today && !t.completed
    )
    setTodayTaskCount(todayTasks.length)

    let max = 0
    for (const habit of habits) {
      const streak = calculateStreak(habit.id, checks)
      if (streak > max) max = streak
    }
    setMaxStreak(max)
  }

  const calculateStreak = (habitId: string, checks: HabitCheck[]): number => {
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

  const handleAddTask = () => {
    setEditingTask(null)
    setTaskModalOpen(true)
  }

  const handleEditTask = (task: Task) => {
    setEditingTask(task)
    setTaskModalOpen(true)
  }

  const handleAddHabit = () => {
    setEditingHabit(null)
    setHabitModalOpen(true)
  }

  const handleTaskSaved = () => {
    setRefreshKey(prev => prev + 1)
    setupReminders()
  }

  const handleHabitSaved = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleExport = async () => {
    const data = await exportData()
    const dateStr = new Date().toISOString().split('T')[0]
    downloadJSON(data, `tracker-backup-${dateStr}.json`)
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data: ExportData = JSON.parse(text)
      if (data.tasks && data.habits && data.habitChecks) {
        await importData(data)
        setRefreshKey(prev => prev + 1)
        alert('数据导入成功！')
      } else {
        alert('无效的数据文件格式')
      }
    } catch (err) {
      alert('导入失败，请检查文件格式')
    }
    e.target.value = ''
  }

  const clearReminders = useCallback(() => {
    reminderTimersRef.current.forEach(timerId => {
      clearTimeout(timerId)
    })
    reminderTimersRef.current = []
  }, [])

  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      setNotificationPermission('denied')
      return false
    }

    if (Notification.permission === 'granted') {
      setNotificationPermission('granted')
      return true
    }

    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      setNotificationPermission(result)
      return result === 'granted'
    }

    setNotificationPermission(Notification.permission)
    return false
  }, [])

  const setupReminders = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('denied')
      return
    }

    setNotificationPermission(Notification.permission)

    if (Notification.permission !== 'granted') return

    clearReminders()

    const tasks = await taskDB.getAll()
    const now = Date.now()

    tasks.forEach(task => {
      if (task.completed || !task.remindMinutes) return

      const dueTime = new Date(task.dueDate).getTime()
      const remindTime = dueTime - task.remindMinutes * 60 * 1000

      if (remindTime > now) {
        const delay = remindTime - now
        const timerId = window.setTimeout(() => {
          if (Notification.permission === 'granted') {
            new Notification('任务提醒', {
              body: `任务「${task.title}」将在 ${task.remindMinutes} 分钟后到期`,
              icon: '/favicon.svg'
            })
          }
        }, delay)
        reminderTimersRef.current.push(timerId)
      }
    })
  }, [clearReminders])

  useEffect(() => {
    setupReminders()
    return () => {
      clearReminders()
    }
  }, [setupReminders, clearReminders])

  const handleSetReminder = useCallback(async () => {
    const granted = await requestNotificationPermission()
    if (granted) {
      setupReminders()
    }
    return granted
  }, [requestNotificationPermission, setupReminders])

  const testReminder = useCallback(() => {
    if (Notification.permission === 'granted') {
      new Notification('测试提醒', {
        body: '这是一条测试通知，提醒功能正常工作！',
        icon: '/favicon.svg'
      })
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        todayTaskCount={todayTaskCount}
        streakDays={maxStreak}
        onExport={handleExport}
        onImport={handleImportClick}
        isMobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col md:flex-row min-h-screen">
        <div className="md:hidden sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Menu size={24} />
          </button>
        </div>

        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            <TaskBoard
              key={`tasks-${refreshKey}-${selectedCategory}`}
              selectedCategory={selectedCategory}
              onAddTask={handleAddTask}
              onEditTask={handleEditTask}
            />
          </div>
        </main>

        <aside className="w-full md:w-96 bg-white border-l border-gray-100 p-6 overflow-y-auto">
          <HabitCalendar
            key={`habits-${refreshKey}`}
            onAddHabit={handleAddHabit}
          />
        </aside>
      </div>

      <TaskFormModal
        isOpen={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        task={editingTask}
        onSaved={handleTaskSaved}
        notificationPermission={notificationPermission}
        onRequestPermission={handleSetReminder}
        onTestReminder={testReminder}
      />

      <HabitFormModal
        isOpen={habitModalOpen}
        onClose={() => setHabitModalOpen(false)}
        habit={editingHabit}
        onSaved={handleHabitSaved}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
      />
    </div>
  )
}

export default App
