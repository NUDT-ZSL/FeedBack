import type { Reminder } from '@/types'

export const REMINDERS_KEY = 'mindjournal_reminders'
export const UNREAD_KEY = 'mindjournal_unread_reminders'

export interface QueuedReminder {
  id: string
  message: string
  timestamp: number
}

export interface ReminderState {
  reminders: Reminder[]
  unreadQueue: QueuedReminder[]
}

export interface ReminderStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ReminderCoreOptions {
  storage: ReminderStorage
  /** 外部传入的状态对象；服务层可传入 reactive 状态以获得响应式 */
  state?: ReminderState
  /** 触发提醒时的通知回调 */
  onNotify?: (message: string) => void
  /** 时钟，便于测试注入固定时间 */
  now?: () => Date
}

export const DEFAULT_REMINDERS: Reminder[] = [
  {
    id: 'default-morning',
    enabled: true,
    hour: 9,
    minute: 0,
    targetEmotion: 'happy',
    message: '早上好！今天有什么让你开心的小事呢？快来记录一下吧～'
  },
  {
    id: 'default-evening',
    enabled: true,
    hour: 21,
    minute: 0,
    targetEmotion: null,
    message: '夜深了，今天过得怎么样？花几分钟记录一下心情吧 💭'
  }
]

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}

export function createReminderCore(options: ReminderCoreOptions) {
  const storage = options.storage
  const onNotify = options.onNotify ?? (() => {})
  const now = options.now ?? (() => new Date())
  const state: ReminderState = options.state ?? { reminders: [], unreadQueue: [] }

  let loaded = false

  function persistReminders() {
    try {
      storage.setItem(REMINDERS_KEY, JSON.stringify(state.reminders))
    } catch (e) {
      console.error('Failed to save reminders:', e)
    }
  }

  function persistUnread() {
    try {
      storage.setItem(UNREAD_KEY, JSON.stringify(state.unreadQueue))
    } catch (e) {
      console.error('Failed to save unread queue:', e)
    }
  }

  function load() {
    try {
      const savedReminders = storage.getItem(REMINDERS_KEY)
      if (savedReminders) {
        state.reminders = JSON.parse(savedReminders)
      } else {
        state.reminders = DEFAULT_REMINDERS.map(r => ({ ...r }))
        persistReminders()
      }
    } catch (e) {
      console.error('Failed to load reminders:', e)
      state.reminders = DEFAULT_REMINDERS.map(r => ({ ...r }))
    }

    try {
      const savedUnread = storage.getItem(UNREAD_KEY)
      state.unreadQueue = savedUnread ? JSON.parse(savedUnread) : []
    } catch (e) {
      console.error('Failed to load unread queue:', e)
      state.unreadQueue = []
    }

    loaded = true
  }

  function ensureLoaded() {
    if (!loaded) load()
  }

  return {
    state,

    load,

    /** 重新从存储加载，覆盖内存状态 */
    reload() {
      load()
    },

    /** 重置为默认提醒并清空未读，同时持久化 */
    reset() {
      state.reminders = DEFAULT_REMINDERS.map(r => ({ ...r }))
      state.unreadQueue = []
      persistReminders()
      persistUnread()
      loaded = true
    },

    getReminders(): Reminder[] {
      ensureLoaded()
      return [...state.reminders]
    },

    addReminder(reminder: Omit<Reminder, 'id'>): Reminder {
      ensureLoaded()
      const newReminder: Reminder = { ...reminder, id: generateId() }
      state.reminders.push(newReminder)
      persistReminders()
      return newReminder
    },

    updateReminder(id: string, updates: Partial<Omit<Reminder, 'id'>>): boolean {
      ensureLoaded()
      const index = state.reminders.findIndex(r => r.id === id)
      if (index === -1) return false
      state.reminders[index] = { ...state.reminders[index], ...updates }
      persistReminders()
      return true
    },

    deleteReminder(id: string): boolean {
      ensureLoaded()
      const index = state.reminders.findIndex(r => r.id === id)
      if (index === -1) return false
      state.reminders.splice(index, 1)
      persistReminders()
      return true
    },

    getUnreadCount(): number {
      ensureLoaded()
      return state.unreadQueue.length
    },

    markAllAsRead() {
      ensureLoaded()
      state.unreadQueue = []
      persistUnread()
    },

    markAsRead(id: string) {
      ensureLoaded()
      const index = state.unreadQueue.findIndex(q => q.id === id)
      if (index !== -1) {
        state.unreadQueue.splice(index, 1)
        persistUnread()
      }
    },

    /** 检查到点的提醒并触发；同一提醒每天只触发一次 */
    checkAndTrigger() {
      ensureLoaded()
      const current = now()

      state.reminders.forEach(reminder => {
        if (!reminder.enabled) return

        const alreadyTriggered = state.unreadQueue.some(
          q => q.id === reminder.id &&
            new Date(q.timestamp).toDateString() === current.toDateString()
        )
        if (alreadyTriggered) return

        if (reminder.hour === current.getHours() && reminder.minute === current.getMinutes()) {
          onNotify(reminder.message)
          state.unreadQueue.push({
            id: reminder.id,
            message: reminder.message,
            timestamp: current.getTime()
          })
          persistUnread()
        }
      })
    }
  }
}

export type ReminderCore = ReturnType<typeof createReminderCore>
