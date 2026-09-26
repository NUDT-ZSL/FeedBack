import express from 'express'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'
import type { Task, Habit, HabitCheck, Priority, Category } from '../client/types'

const app = express()
const PORT = 3002

app.use(cors())
app.use(express.json())

let tasks: Task[] = []
let habits: Habit[] = []
let habitChecks: HabitCheck[] = []

const priorityWeight: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1
}

function sortTasks(taskList: Task[]): Task[] {
  return [...taskList].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    const priorityDiff = priorityWeight[b.priority] - priorityWeight[a.priority]
    if (priorityDiff !== 0) return priorityDiff
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  })
}

app.get('/api/tasks', (_req, res) => {
  res.json(sortTasks(tasks))
})

app.post('/api/tasks', (req, res) => {
  const { title, dueDate, priority, category, remindMinutes } = req.body
  const newTask: Task = {
    id: uuidv4(),
    title,
    dueDate,
    priority: priority as Priority,
    category: category as Category,
    completed: false,
    remindMinutes,
    createdAt: new Date().toISOString()
  }
  tasks.push(newTask)
  res.status(201).json(newTask)
})

app.put('/api/tasks/:id', (req, res) => {
  const { id } = req.params
  const taskIndex = tasks.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  tasks[taskIndex] = { ...tasks[taskIndex], ...req.body }
  res.json(tasks[taskIndex])
})

app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params
  const taskIndex = tasks.findIndex(t => t.id === id)
  if (taskIndex === -1) {
    res.status(404).json({ error: 'Task not found' })
    return
  }
  tasks.splice(taskIndex, 1)
  res.json({ success: true })
})

app.get('/api/habits', (_req, res) => {
  res.json(habits)
})

app.post('/api/habits', (req, res) => {
  const { name, icon } = req.body
  const newHabit: Habit = {
    id: uuidv4(),
    name,
    icon,
    createdAt: new Date().toISOString()
  }
  habits.push(newHabit)
  res.status(201).json(newHabit)
})

app.put('/api/habits/:id', (req, res) => {
  const { id } = req.params
  const habitIndex = habits.findIndex(h => h.id === id)
  if (habitIndex === -1) {
    res.status(404).json({ error: 'Habit not found' })
    return
  }
  habits[habitIndex] = { ...habits[habitIndex], ...req.body }
  res.json(habits[habitIndex])
})

app.delete('/api/habits/:id', (req, res) => {
  const { id } = req.params
  const habitIndex = habits.findIndex(h => h.id === id)
  if (habitIndex === -1) {
    res.status(404).json({ error: 'Habit not found' })
    return
  }
  habits.splice(habitIndex, 1)
  habitChecks = habitChecks.filter(hc => hc.habitId !== id)
  res.json({ success: true })
})

app.get('/api/habit-checks', (_req, res) => {
  res.json(habitChecks)
})

app.post('/api/habit-checks', (req, res) => {
  const { habitId, date, completed } = req.body
  const existingIndex = habitChecks.findIndex(
    hc => hc.habitId === habitId && hc.date === date
  )
  if (existingIndex !== -1) {
    habitChecks[existingIndex] = { habitId, date, completed }
    res.json(habitChecks[existingIndex])
  } else {
    const newCheck: HabitCheck = { habitId, date, completed }
    habitChecks.push(newCheck)
    res.status(201).json(newCheck)
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
