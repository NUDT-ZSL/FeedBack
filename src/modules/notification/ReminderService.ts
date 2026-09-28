import type { Reminder, EmotionType } from '@/types'
import { EMOTION_LABELS } from '@/types'

const REMINDERS_KEY = 'mindjournal_reminders'
const UNREAD_KEY = 'mindjournal_unread_reminders'

interface QueuedReminder {
  id: string
  message: string
  timestamp: number
}

const DEFAULT_REMINDERS: Reminder[] = [
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

let reminders: Reminder[] = []
let unreadQueue: QueuedReminder[] = []
let checkInterval: number | null = null
let lastCheckedDate = ''

function padZero(n: number): string {
  return n.toString().padStart(2, '0')
}

function loadReminders() {
  try {
    const saved = localStorage.getItem(REMINDERS_KEY)
    if (saved) {
      reminders = JSON.parse(saved)
    } else {
      reminders = [...DEFAULT_REMINDERS]
      saveReminders()
    }
  } catch (e) {
    console.error('Failed to load reminders:', e)
    reminders = [...DEFAULT_REMINDERS]
  }
}

function saveReminders() {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders))
  } catch (e) {
    console.error('Failed to save reminders:', e)
  }
}

function loadUnreadQueue() {
  try {
    const saved = localStorage.getItem(UNREAD_KEY)
    if (saved) {
      unreadQueue = JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load unread queue:', e)
  }
}

function saveUnreadQueue() {
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify(unreadQueue))
  } catch (e) {
    console.error('Failed to save unread queue:', e)
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
}

function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications')
    return Promise.resolve(false)
  }

  if (Notification.permission === 'granted') {
    return Promise.resolve(true)
  }

  if (Notification.permission !== 'denied') {
    return Notification.requestPermission().then(perm => perm === 'granted')
  }

  return Promise.resolve(false)
}

function showNotification(message: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('MindJournal 💭', {
        body: message,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💭</text></svg>'
      })
    } catch (e) {
      console.error('Failed to show notification:', e)
    }
  }
}

function checkAndTriggerReminders() {
  const now = new Date()
  const currentKey = `${now.getFullYear()}-${padZero(now.getMonth() + 1)}-${padZero(now.getDate())}`
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()

  reminders.forEach(reminder => {
    if (!reminder.enabled) return

    const triggeredKey = `${currentKey}-${reminder.id}`
    const alreadyTriggered = unreadQueue.some(
      q => q.id === reminder.id && new Date(q.timestamp).toDateString() === now.toDateString()
    )

    if (alreadyTriggered) return

    if (reminder.hour === currentHour && reminder.minute === currentMinute) {
      showNotification(reminder.message)
      unreadQueue.push({
        id: reminder.id,
        message: reminder.message,
        timestamp: now.getTime()
      })
      saveUnreadQueue()
    }
  })

  lastCheckedDate = currentKey
}

export function startReminderService() {
  if (checkInterval !== null) return

  loadReminders()
  loadUnreadQueue()
  requestNotificationPermission()

  checkAndTriggerReminders()

  checkInterval = window.setInterval(() => {
    checkAndTriggerReminders()
  }, 30000)
}

export function stopReminderService() {
  if (checkInterval !== null) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export function getReminders(): Reminder[] {
  return [...reminders]
}

export function addReminder(reminder: Omit<Reminder, 'id'>): Reminder {
  const newReminder: Reminder = {
    ...reminder,
    id: generateId()
  }
  reminders.push(newReminder)
  saveReminders()
  return newReminder
}

export function updateReminder(id: string, updates: Partial<Omit<Reminder, 'id'>>): boolean {
  const index = reminders.findIndex(r => r.id === id)
  if (index === -1) return false
  reminders[index] = { ...reminders[index], ...updates }
  saveReminders()
  return true
}

export function deleteReminder(id: string): boolean {
  const index = reminders.findIndex(r => r.id === id)
  if (index === -1) return false
  reminders.splice(index, 1)
  saveReminders()
  return true
}

export function getUnreadCount(): number {
  loadUnreadQueue()
  return unreadQueue.length
}

export function markAllAsRead() {
  unreadQueue = []
  saveUnreadQueue()
}

export function markAsRead(id: string) {
  const index = unreadQueue.findIndex(q => q.id === id)
  if (index !== -1) {
    unreadQueue.splice(index, 1)
    saveUnreadQueue()
  }
}

export { EMOTION_LABELS }
