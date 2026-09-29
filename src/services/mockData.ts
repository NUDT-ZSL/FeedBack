import { addDays, format } from 'date-fns'
import type { Teacher, TimeSlot, Booking, LessonLog, PracticeFeedbackItem } from '../types'

export const TEACHERS: Teacher[] = [
  {
    id: 't1',
    name: '林雅琴',
    instruments: ['钢琴', '古筝'],
    avatar: '🎹'
  },
  {
    id: 't2',
    name: '陈弦歌',
    instruments: ['小提琴', '吉他'],
    avatar: '🎻'
  },
  {
    id: 't3',
    name: '王节奏',
    instruments: ['架子鼓', '吉他'],
    avatar: '🥁'
  }
]

const TODAY = new Date()
const HOURS = Array.from({ length: 10 }, (_, i) => i + 9)

function generateTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = []
  let slotId = 0
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = format(addDays(TODAY, dayOffset), 'yyyy-MM-dd')
    for (const teacher of TEACHERS) {
      for (const hour of HOURS) {
        const startTime = `${hour.toString().padStart(2, '0')}:00`
        const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`
        const isBooked =
          (dayOffset === 0 && (hour === 10 || hour === 14) && teacher.id === 't1') ||
          (dayOffset === 1 && hour === 11 && teacher.id === 't2') ||
          (dayOffset === 2 && hour === 15 && teacher.id === 't3')
        slots.push({
          id: `slot_${++slotId}`,
          teacherId: teacher.id,
          date,
          startTime,
          endTime,
          status: isBooked ? 'booked' : 'free'
        })
      }
    }
  }
  return slots
}

function generateInitialBookings(): Booking[] {
  return [
    {
      id: 'b1',
      teacherId: 't1',
      studentName: '张小明',
      studentPhone: '13812345678',
      instrument: '钢琴',
      date: format(TODAY, 'yyyy-MM-dd'),
      startTime: '10:00',
      endTime: '11:00',
      createdAt: new Date().toISOString()
    },
    {
      id: 'b2',
      teacherId: 't1',
      studentName: '李小红',
      studentPhone: '13987654321',
      instrument: '古筝',
      date: format(TODAY, 'yyyy-MM-dd'),
      startTime: '14:00',
      endTime: '15:00',
      createdAt: new Date().toISOString()
    },
    {
      id: 'b3',
      teacherId: 't2',
      studentName: '王小强',
      studentPhone: '13611112222',
      instrument: '小提琴',
      date: format(addDays(TODAY, 1), 'yyyy-MM-dd'),
      startTime: '11:00',
      endTime: '12:00',
      createdAt: new Date().toISOString()
    },
    {
      id: 'b4',
      teacherId: 't3',
      studentName: '赵小美',
      studentPhone: '13733334444',
      instrument: '架子鼓',
      date: format(addDays(TODAY, 2), 'yyyy-MM-dd'),
      startTime: '15:00',
      endTime: '16:00',
      createdAt: new Date().toISOString()
    }
  ]
}

function generateInitialLogs(): LessonLog[] {
  return [
    {
      id: 'log1',
      bookingId: 'past1',
      teacherId: 't1',
      studentName: '张小明',
      date: format(addDays(TODAY, -3), 'yyyy-MM-dd'),
      content:
        '本节课重点练习了C大调音阶和哈农指法练习第1-5条，学生手部姿态有明显进步，节奏感较好。作业：每天练习音阶20分钟，哈农第3条反复练习。',
      rating: 4,
      suggestion: '建议在弹奏时多注意手腕放松，保持自然弧度。',
      createdAt: new Date().toISOString()
    },
    {
      id: 'log2',
      bookingId: 'past2',
      teacherId: 't2',
      studentName: '王小强',
      date: format(addDays(TODAY, -2), 'yyyy-MM-dd'),
      content:
        '学习了换把位的基本技巧，练习了第一把位到第三把位的转换。音准掌握良好，但换把动作还需要更流畅。',
      rating: 5,
      suggestion: '建议用节拍器配合慢练，确保每个音都清晰准确。',
      createdAt: new Date().toISOString()
    },
    {
      id: 'log3',
      bookingId: 'past3',
      teacherId: 't3',
      studentName: '赵小美',
      date: format(addDays(TODAY, -1), 'yyyy-MM-dd'),
      content:
        '学习了基本的八分音符节奏型，练习了单跳双跳基础。手脚协调性不错，注意保持稳定的速度。',
      rating: 3,
      suggestion: '多练习慢速度的基础单击，确保每个鼓点的力度均匀。',
      createdAt: new Date().toISOString()
    }
  ]
}

function generateInitialFeedbacks(): PracticeFeedbackItem[] {
  return []
}

export const initialTimeSlots = generateTimeSlots()
export const initialBookings = generateInitialBookings()
export const initialLessonLogs = generateInitialLogs()
export const initialFeedbacks = generateInitialFeedbacks()
