import {
  initialTimeSlots,
  initialBookings,
  initialLessonLogs,
  initialFeedbacks,
  TEACHERS
} from './mockData'
import type {
  TimeSlot,
  Booking,
  LessonLog,
  PracticeFeedbackItem,
  Teacher,
  InstrumentType,
  SelectedSlot
} from '../types'
import { format, isSameDay, parseISO } from 'date-fns'

let timeSlots: TimeSlot[] = [...initialTimeSlots]
let bookings: Booking[] = [...initialBookings]
let lessonLogs: LessonLog[] = [...initialLessonLogs]
let feedbacks: PracticeFeedbackItem[] = [...initialFeedbacks]

function delay<T>(data: T, ms: number = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms))
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const api = {
  async getTeachers(): Promise<Teacher[]> {
    return delay(TEACHERS, 80)
  },

  async getSchedules(): Promise<{ slots: TimeSlot[]; bookings: Booking[] }> {
    return delay({ slots: [...timeSlots], bookings: [...bookings] }, 200)
  },

  async submitBooking(
    slot: SelectedSlot,
    data: {
      studentName: string
      studentPhone: string
      instrument: InstrumentType
    }
  ): Promise<{ booking: Booking; updatedSlot: TimeSlot }> {
    const booking: Booking = {
      id: generateId('b'),
      teacherId: slot.teacherId,
      studentName: data.studentName,
      studentPhone: data.studentPhone,
      instrument: data.instrument,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      createdAt: new Date().toISOString()
    }
    bookings.push(booking)
    const slotIndex = timeSlots.findIndex((s) => s.id === slot.id)
    if (slotIndex !== -1) {
      timeSlots[slotIndex] = {
        ...timeSlots[slotIndex],
        status: 'booked',
        bookingId: booking.id
      }
    }
    const updatedSlot = { ...timeSlots[slotIndex] }
    return delay({ booking, updatedSlot }, 180)
  },

  async getTodayBookings(teacherId: string): Promise<Booking[]> {
    const today = format(new Date(), 'yyyy-MM-dd')
    const result = bookings.filter(
      (b) => b.date === today && b.teacherId === teacherId
    )
    return delay(result, 120)
  },

  async saveLessonLog(
    data: Omit<LessonLog, 'id' | 'createdAt'>
  ): Promise<LessonLog> {
    const log: LessonLog = {
      ...data,
      id: generateId('log'),
      createdAt: new Date().toISOString()
    }
    lessonLogs.push(log)
    return delay(log, 250)
  },

  async getRecentLogs(studentName: string): Promise<LessonLog[]> {
    const result = [...lessonLogs]
      .filter((log) => log.studentName === studentName)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
      .slice(0, 5)
    return delay(result, 100)
  },

  async getAllRecentLogs(): Promise<LessonLog[]> {
    const result = [...lessonLogs]
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime())
      .slice(0, 5)
    return delay(result, 100)
  },

  async submitFeedback(
    data: Omit<PracticeFeedbackItem, 'id' | 'submittedAt'>
  ): Promise<PracticeFeedbackItem> {
    const feedback: PracticeFeedbackItem = {
      ...data,
      id: generateId('fb'),
      submittedAt: new Date().toISOString()
    }
    feedbacks.push(feedback)
    return delay(feedback, 150)
  },

  async checkLogExists(bookingId: string): Promise<LessonLog | undefined> {
    return delay(lessonLogs.find((log) => log.bookingId === bookingId), 60)
  }
}
