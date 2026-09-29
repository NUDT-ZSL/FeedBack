import { describe, it, expect } from 'vitest'
import {
  createReminderCore,
  DEFAULT_REMINDERS,
  REMINDERS_KEY,
  UNREAD_KEY,
  type ReminderStorage
} from '../reminderCore'

function createMemoryStorage(): ReminderStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => { data.set(key, value) }
  }
}

describe('reminderCore（单一状态来源）', () => {
  it('首次加载写入默认提醒并持久化', () => {
    const storage = createMemoryStorage()
    const core = createReminderCore({ storage })
    const reminders = core.getReminders()
    expect(reminders).toHaveLength(DEFAULT_REMINDERS.length)
    expect(JSON.parse(storage.data.get(REMINDERS_KEY)!)).toHaveLength(DEFAULT_REMINDERS.length)
  })

  it('新增/更新/删除提醒并持久化', () => {
    const storage = createMemoryStorage()
    const core = createReminderCore({ storage })

    const added = core.addReminder({
      enabled: true,
      hour: 8,
      minute: 30,
      targetEmotion: null,
      message: '测试提醒'
    })
    expect(core.getReminders()).toHaveLength(DEFAULT_REMINDERS.length + 1)

    expect(core.updateReminder(added.id, { enabled: false })).toBe(true)
    expect(core.getReminders().find(r => r.id === added.id)?.enabled).toBe(false)

    expect(core.deleteReminder(added.id)).toBe(true)
    expect(core.getReminders()).toHaveLength(DEFAULT_REMINDERS.length)

    const persisted = JSON.parse(storage.data.get(REMINDERS_KEY)!)
    expect(persisted).toHaveLength(DEFAULT_REMINDERS.length)
  })

  it('到点触发提醒，同一天不重复触发，未读数与队列一致', () => {
    const storage = createMemoryStorage()
    const notified: string[] = []
    const core = createReminderCore({
      storage,
      onNotify: msg => notified.push(msg),
      now: () => new Date(2026, 8, 29, 9, 0, 0)
    })

    core.checkAndTrigger()
    expect(notified).toEqual([DEFAULT_REMINDERS[0].message])
    expect(core.getUnreadCount()).toBe(1)
    expect(core.state.unreadQueue).toHaveLength(1)

    core.checkAndTrigger()
    expect(notified).toHaveLength(1)
    expect(core.getUnreadCount()).toBe(1)
  })

  it('全部已读与单条已读', () => {
    const storage = createMemoryStorage()
    const core = createReminderCore({
      storage,
      now: () => new Date(2026, 8, 29, 9, 0, 0)
    })
    core.checkAndTrigger()
    expect(core.getUnreadCount()).toBe(1)

    core.markAsRead(DEFAULT_REMINDERS[0].id)
    expect(core.getUnreadCount()).toBe(0)

    core.state.unreadQueue.push(
      { id: 'a', message: 'm1', timestamp: 1 },
      { id: 'b', message: 'm2', timestamp: 2 }
    )
    core.markAllAsRead()
    expect(core.getUnreadCount()).toBe(0)
    expect(JSON.parse(storage.data.get(UNREAD_KEY)!)).toEqual([])
  })

  it('重置恢复默认提醒并清空未读，重新加载与存储一致', () => {
    const storage = createMemoryStorage()
    const core = createReminderCore({
      storage,
      now: () => new Date(2026, 8, 29, 9, 0, 0)
    })
    core.checkAndTrigger()
    core.deleteReminder(DEFAULT_REMINDERS[0].id)

    core.reset()
    expect(core.getReminders()).toHaveLength(DEFAULT_REMINDERS.length)
    expect(core.getUnreadCount()).toBe(0)

    // 模拟另一入口直接改存储后，reload 能读到一致状态
    storage.setItem(UNREAD_KEY, JSON.stringify([{ id: 'x', message: 'm', timestamp: 3 }]))
    core.reload()
    expect(core.getUnreadCount()).toBe(1)
    expect(core.state.unreadQueue[0].id).toBe('x')
  })
})
