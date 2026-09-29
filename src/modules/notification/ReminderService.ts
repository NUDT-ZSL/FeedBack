import { reactive } from 'vue'
import type { Reminder } from '@/types'
import { EMOTION_LABELS } from '@/types'
import {
  createReminderCore,
  type ReminderState,
  type QueuedReminder
} from './reminderCore'

/**
 * 提醒服务的唯一状态来源。
 * 所有入口（导航角标、设置页等）都读取这份响应式状态，
 * 保证未读数和提醒列表在任何地方都一致。
 */
const state = reactive<ReminderState>({
  reminders: [],
  unreadQueue: []
})

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

const core = createReminderCore({
  storage: localStorage,
  state,
  onNotify: showNotification
})

let checkInterval: number | null = null

export function startReminderService() {
  if (checkInterval !== null) return

  core.load()
  requestNotificationPermission()
  core.checkAndTrigger()

  checkInterval = window.setInterval(() => {
    core.checkAndTrigger()
  }, 30000)
}

export function stopReminderService() {
  if (checkInterval !== null) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

/** 重置为默认提醒并清空未读 */
export function resetReminderService() {
  core.reset()
}

/** 重新从存储加载提醒与未读队列 */
export function reloadReminderService() {
  core.reload()
}

export function getReminders(): Reminder[] {
  return core.getReminders()
}

export function addReminder(reminder: Omit<Reminder, 'id'>): Reminder {
  return core.addReminder(reminder)
}

export function updateReminder(id: string, updates: Partial<Omit<Reminder, 'id'>>): boolean {
  return core.updateReminder(id, updates)
}

export function deleteReminder(id: string): boolean {
  return core.deleteReminder(id)
}

export function getUnreadCount(): number {
  return core.getUnreadCount()
}

export function markAllAsRead() {
  core.markAllAsRead()
}

export function markAsRead(id: string) {
  core.markAsRead(id)
}

/** 响应式状态，供组件直接 computed 订阅 */
export const reminderState = state

export type { QueuedReminder }
export { EMOTION_LABELS }
