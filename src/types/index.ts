export type InstrumentType = '钢琴' | '小提琴' | '吉他' | '古筝' | '架子鼓'

export type SlotStatus = 'free' | 'booked'

export interface Teacher {
  id: string
  name: string
  instruments: InstrumentType[]
  avatar: string
}

export interface TimeSlot {
  id: string
  teacherId: string
  date: string
  startTime: string
  endTime: string
  status: SlotStatus
  bookingId?: string
}

export interface Booking {
  id: string
  teacherId: string
  studentName: string
  studentPhone: string
  instrument: InstrumentType
  date: string
  startTime: string
  endTime: string
  createdAt: string
}

export interface LessonLog {
  id: string
  bookingId: string
  teacherId: string
  studentName: string
  date: string
  content: string
  rating: 1 | 2 | 3 | 4 | 5
  suggestion?: string
  createdAt: string
}

export interface PracticeFeedbackItem {
  id: string
  logId: string
  studentName: string
  feedbackText: string
  duration: 15 | 30 | 45 | 60
  submittedAt: string
}

export type UserRole = 'student' | 'teacher'

export interface SelectedSlot {
  id: string
  teacherId: string
  date: string
  startTime: string
  endTime: string
}

export const INSTRUMENT_OPTIONS: InstrumentType[] = [
  '钢琴',
  '小提琴',
  '吉他',
  '古筝',
  '架子鼓'
]

export const DURATION_OPTIONS = [15, 30, 45, 60] as const
