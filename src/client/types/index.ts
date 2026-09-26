export type Priority = 'high' | 'medium' | 'low'

export type Category = 'work' | 'study' | 'life'

export interface Task {
  id: string
  title: string
  dueDate: string
  priority: Priority
  category: Category
  completed: boolean
  remindMinutes?: number
  createdAt: string
}

export interface Habit {
  id: string
  name: string
  icon?: string
  createdAt: string
}

export interface HabitCheck {
  habitId: string
  date: string
  completed: boolean
}

export interface ExportData {
  tasks: Task[]
  habits: Habit[]
  habitChecks: HabitCheck[]
  exportedAt: string
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低'
}

export const CATEGORY_LABELS: Record<Category, string> = {
  work: '工作',
  study: '学习',
  life: '生活'
}

export const REMIND_OPTIONS = [
  { value: 0, label: '不提醒' },
  { value: 5, label: '提前5分钟' },
  { value: 15, label: '提前15分钟' },
  { value: 30, label: '提前30分钟' }
]
