import { openDB, type IDBPDatabase } from 'idb'
import type { Task, Habit, HabitCheck, ExportData } from '../types'

const DB_NAME = 'trackerDB'
const DB_VERSION = 1

const TASKS_STORE = 'tasks'
const HABITS_STORE = 'habits'
const HABIT_CHECKS_STORE = 'habitChecks'

let db: IDBPDatabase | null = null

async function initDB(): Promise<IDBPDatabase> {
  if (db) return db

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        const taskStore = db.createObjectStore(TASKS_STORE, { keyPath: 'id' })
        taskStore.createIndex('by_dueDate', 'dueDate')
        taskStore.createIndex('by_priority', 'priority')
        taskStore.createIndex('by_category', 'category')
      }

      if (!db.objectStoreNames.contains(HABITS_STORE)) {
        const habitStore = db.createObjectStore(HABITS_STORE, { keyPath: 'id' })
        habitStore.createIndex('by_name', 'name')
      }

      if (!db.objectStoreNames.contains(HABIT_CHECKS_STORE)) {
        const checkStore = db.createObjectStore(HABIT_CHECKS_STORE, {
          keyPath: ['habitId', 'date']
        })
        checkStore.createIndex('by_habitId', 'habitId')
        checkStore.createIndex('by_date', 'date')
      }
    }
  })

  return db
}

export const taskDB = {
  async getAll(): Promise<Task[]> {
    const database = await initDB()
    return database.getAll(TASKS_STORE)
  },

  async add(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const database = await initDB()
    const newTask: Task = {
      ...task,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    await database.add(TASKS_STORE, newTask)
    return newTask
  },

  async update(id: string, updates: Partial<Task>): Promise<Task | undefined> {
    const database = await initDB()
    const task = await database.get(TASKS_STORE, id)
    if (!task) return undefined
    const updatedTask = { ...task, ...updates }
    await database.put(TASKS_STORE, updatedTask)
    return updatedTask
  },

  async delete(id: string): Promise<void> {
    const database = await initDB()
    await database.delete(TASKS_STORE, id)
  },

  async bulkAdd(tasks: Task[]): Promise<void> {
    const database = await initDB()
    const tx = database.transaction(TASKS_STORE, 'readwrite')
    for (const task of tasks) {
      await tx.store.put(task)
    }
    await tx.done
  },

  async clear(): Promise<void> {
    const database = await initDB()
    await database.clear(TASKS_STORE)
  }
}

export const habitDB = {
  async getAll(): Promise<Habit[]> {
    const database = await initDB()
    return database.getAll(HABITS_STORE)
  },

  async add(habit: Omit<Habit, 'id' | 'createdAt'>): Promise<Habit> {
    const database = await initDB()
    const newHabit: Habit = {
      ...habit,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    await database.add(HABITS_STORE, newHabit)
    return newHabit
  },

  async update(id: string, updates: Partial<Habit>): Promise<Habit | undefined> {
    const database = await initDB()
    const habit = await database.get(HABITS_STORE, id)
    if (!habit) return undefined
    const updatedHabit = { ...habit, ...updates }
    await database.put(HABITS_STORE, updatedHabit)
    return updatedHabit
  },

  async delete(id: string): Promise<void> {
    const database = await initDB()
    await database.delete(HABITS_STORE, id)
  },

  async bulkAdd(habits: Habit[]): Promise<void> {
    const database = await initDB()
    const tx = database.transaction(HABITS_STORE, 'readwrite')
    for (const habit of habits) {
      await tx.store.put(habit)
    }
    await tx.done
  },

  async clear(): Promise<void> {
    const database = await initDB()
    await database.clear(HABITS_STORE)
  }
}

export const habitCheckDB = {
  async getAll(): Promise<HabitCheck[]> {
    const database = await initDB()
    return database.getAll(HABIT_CHECKS_STORE)
  },

  async getByHabitId(habitId: string): Promise<HabitCheck[]> {
    const database = await initDB()
    return database.getAllFromIndex(HABIT_CHECKS_STORE, 'by_habitId', habitId)
  },

  async set(check: HabitCheck): Promise<HabitCheck> {
    const database = await initDB()
    await database.put(HABIT_CHECKS_STORE, check)
    return check
  },

  async bulkAdd(checks: HabitCheck[]): Promise<void> {
    const database = await initDB()
    const tx = database.transaction(HABIT_CHECKS_STORE, 'readwrite')
    for (const check of checks) {
      await tx.store.put(check)
    }
    await tx.done
  },

  async clear(): Promise<void> {
    const database = await initDB()
    await database.clear(HABIT_CHECKS_STORE)
  }
}

export async function exportData(): Promise<ExportData> {
  const [tasks, habits, habitChecks] = await Promise.all([
    taskDB.getAll(),
    habitDB.getAll(),
    habitCheckDB.getAll()
  ])

  return {
    tasks,
    habits,
    habitChecks,
    exportedAt: new Date().toISOString()
  }
}

export async function importData(data: ExportData): Promise<void> {
  await Promise.all([taskDB.clear(), habitDB.clear(), habitCheckDB.clear()])
  await Promise.all([
    taskDB.bulkAdd(data.tasks),
    habitDB.bulkAdd(data.habits),
    habitCheckDB.bulkAdd(data.habitChecks)
  ])
}

export function downloadJSON(data: ExportData, filename: string = 'tracker-backup.json'): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
