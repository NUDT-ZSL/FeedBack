import { useState, useEffect, useMemo } from 'react'
import { addDays, format, startOfDay, isSameDay, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TimeSlot, Booking, Teacher, SelectedSlot } from '../types'
import { api } from '../services/api'
import BookingForm from './BookingForm'

interface Props {
  selectedTeacherId: string | null
  teachers: Teacher[]
}

const HOURS = Array.from({ length: 10 }, (_, i) => i + 9)

export default function ScheduleView({ selectedTeacherId, teachers }: Props) {
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null)
  const [mobileDayIndex, setMobileDayIndex] = useState(0)

  const weekStart = useMemo(() => addDays(startOfDay(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const fetchData = async () => {
    setLoading(true)
    const result = await api.getSchedules()
    setSlots(result.slots)
    setBookings(result.bookings)
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredSlots = useMemo(() => {
    let s = slots
    if (selectedTeacherId) s = s.filter((sl) => sl.teacherId === selectedTeacherId)
    return s
  }, [slots, selectedTeacherId])

  const getBookingForSlot = (slotId: string): Booking | undefined => {
    const slot = slots.find((s) => s.id === slotId)
    if (!slot?.bookingId) return undefined
    return bookings.find((b) => b.id === slot.bookingId)
  }

  const getUniqueSlot = (date: string, hour: number): TimeSlot | undefined => {
    const startTime = `${hour.toString().padStart(2, '0')}:00`
    let result: TimeSlot | undefined
    for (const s of filteredSlots) {
      if (s.date === date && s.startTime === startTime) {
        if (!selectedTeacherId) {
          if (s.status === 'free') return s
          result = s
        } else {
          return s
        }
      }
    }
    return result
  }

  const handleSlotClick = (slot: TimeSlot) => {
    if (slot.status === 'booked') return
    setSelectedSlot({
      id: slot.id,
      teacherId: slot.teacherId,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime
    })
  }

  const teacherName = selectedSlot
    ? teachers.find((t) => t.id === selectedSlot.teacherId)?.name || ''
    : ''

  const weekdayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  if (loading) {
    return (
      <div className="schedule-wrapper">
        <div className="empty-state">
          <div className="empty-state-icon">🎵</div>
          <div className="empty-state-text">正在加载排期数据...</div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">课程预约</h1>
        <p className="page-subtitle">
          {selectedTeacherId
            ? `已选择：${teachers.find((t) => t.id === selectedTeacherId)?.name}老师`
            : '浏览所有老师的排期，点击空闲时段预约'}
        </p>
      </div>

      <div className="schedule-wrapper">
        <div className="week-nav">
          <div className="week-nav-left">
            <button className="week-nav-btn" onClick={() => setWeekOffset((w) => w - 1)}>
              <ChevronLeft size={18} />
            </button>
            <div className="week-range-text">
              {format(weekStart, 'MM月dd日')} - {format(addDays(weekStart, 6), 'MM月dd日')}
            </div>
            <button
              className="week-nav-btn"
              onClick={() => setWeekOffset((w) => w + 1)}
              style={{ visibility: weekOffset >= 0 ? 'hidden' : 'visible' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="legend">
            <div className="legend-item">
              <div className="legend-dot" style={{ background: '#E8F5E9' }} />
              空闲可约
            </div>
            <div className="legend-item">
              <div className="legend-dot" style={{ background: '#FFF3E0' }} />
              已预约
            </div>
          </div>
        </div>

        <div className="mobile-day-selector">
          {days.map((day, idx) => {
            const isToday = isSameDay(day, new Date())
            return (
              <div
                key={idx}
                className={`mobile-day-chip ${mobileDayIndex === idx ? 'active' : ''}`}
                onClick={() => setMobileDayIndex(idx)}
              >
                {weekdayMap[day.getDay()]} {format(day, 'dd')}日
                {isToday && ' (今天)'}
              </div>
            )
          })}
        </div>

        <div className="schedule-grid">
          <div style={{ borderRadius: 8 }} />
          {days.map((day, idx) => {
            const isToday = isSameDay(day, new Date())
            const isMobileVisible = idx === mobileDayIndex
            return (
              <div
                key={idx}
                className={`day-header ${isToday ? 'today' : ''} slot-mobile-visible`}
                style={{ display: undefined }}
              >
                <div className="day-header-date">
                  {format(day, 'MM/dd')}
                  {isToday && <span style={{ fontSize: 10, marginLeft: 4 }}>今天</span>}
                </div>
                <div className="day-header-weekday">{weekdayMap[day.getDay()]}</div>
              </div>
            )
          })}

          {HOURS.map((hour) => (
            <div key={`h-${hour}`} style={{ display: 'contents' }}>
              <div className="time-header">
                {hour.toString().padStart(2, '0')}:00
              </div>
              {days.map((day, dayIdx) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const slot = getUniqueSlot(dateStr, hour)
                const booking = slot ? getBookingForSlot(slot.id) : undefined
                const isMobileVisible = dayIdx === mobileDayIndex
                const surname = booking?.studentName.slice(0, 1) || ''

                if (!slot) {
                  return (
                    <div
                      key={`${dateStr}-${hour}`}
                      className="slot-cell"
                      style={{ background: 'transparent', cursor: 'default', border: '1px dashed #f0e6d2' }}
                    />
                  )
                }

                return (
                  <div
                    key={`${dateStr}-${hour}-${slot.id}`}
                    className={`slot-cell ${slot.status} ${isMobileVisible ? 'slot-mobile-visible' : ''}`}
                    onClick={() => handleSlotClick(slot)}
                  >
                    {slot.status === 'free' ? (
                      <div className="slot-book-btn">预约</div>
                    ) : (
                      <div className="slot-surname-wrap">
                        <span className="slot-surname">{surname}同学</span>
                        {booking && <span className="slot-ins-tag">{booking.instrument}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedSlot && (
        <BookingForm
          slot={selectedSlot}
          teacherName={teacherName}
          onClose={() => setSelectedSlot(null)}
          onSuccess={fetchData}
        />
      )}
    </div>
  )
}
