import { useState, useEffect } from 'react'
import { Check, X, Music, Phone, User } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Booking, Teacher, LessonLog } from '../types'
import { api } from '../services/api'

interface Props {
  currentTeacherId: string
  teachers: Teacher[]
}

export default function TeacherDashboard({ currentTeacherId, teachers }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null)
  const [panelClosing, setPanelClosing] = useState(false)
  const [savedLogIds, setSavedLogIds] = useState<Set<string>>(new Set())

  const [content, setContent] = useState('')
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0)
  const [suggestion, setSuggestion] = useState('')
  const [clickedStar, setClickedStar] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ content?: string; rating?: string }>({})

  const teacher = teachers.find((t) => t.id === currentTeacherId)

  const fetchBookings = async () => {
    setLoading(true)
    const data = await api.getTodayBookings(currentTeacherId)
    setBookings(data.sort((a, b) => a.startTime.localeCompare(b.startTime)))
    const savedSet = new Set<string>()
    for (const b of data) {
      const log = await api.checkLogExists(b.id)
      if (log) savedSet.add(b.id)
    }
    setSavedLogIds(savedSet)
    setLoading(false)
  }

  useEffect(() => {
    fetchBookings()
  }, [currentTeacherId])

  const handleOpenPanel = (booking: Booking) => {
    if (savedLogIds.has(booking.id)) {
      toast('该课程日志已记录', { icon: 'ℹ️', style: { background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9' } })
      return
    }
    setActiveBookingId(booking.id)
    setPanelClosing(false)
    setContent('')
    setRating(0)
    setSuggestion('')
    setErrors({})
  }

  const handleClosePanel = () => {
    setPanelClosing(true)
    setTimeout(() => {
      setActiveBookingId(null)
      setPanelClosing(false)
    }, 320)
  }

  const handleStarClick = (star: 1 | 2 | 3 | 4 | 5) => {
    setRating(star)
    setClickedStar(star)
    setTimeout(() => setClickedStar(null), 300)
  }

  const activeBooking = bookings.find((b) => b.id === activeBookingId)

  const validateAndSave = async () => {
    const newErrors: typeof errors = {}
    if (!content.trim()) newErrors.content = '请填写本节课内容'
    else if (content.length > 500) newErrors.content = '内容不能超过500字'
    if (rating === 0) newErrors.rating = '请选择星级评分'
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return
    if (!activeBooking) return

    setSaving(true)
    try {
      const log: Omit<LessonLog, 'id' | 'createdAt'> = {
        bookingId: activeBooking.id,
        teacherId: currentTeacherId,
        studentName: activeBooking.studentName,
        date: activeBooking.date,
        content: content.trim(),
        rating: rating as 1 | 2 | 3 | 4 | 5,
        suggestion: suggestion.trim() || undefined
      }
      await api.saveLessonLog(log)
      setSavedLogIds((prev) => new Set(prev).add(activeBooking.id))
      toast.success('课程日志已保存')
      handleClosePanel()
    } catch {
      toast.error('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">老师仪表盘</h1>
        <p className="page-subtitle">
          欢迎回来，{teacher?.name}老师 · 今日共 {bookings.length} 节课程
        </p>
      </div>

      <div className="teacher-layout">
        <div className="bookings-list">
          {loading ? (
            <div className="schedule-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-text">正在加载今日课表...</div>
              </div>
            </div>
          ) : bookings.length === 0 ? (
            <div className="schedule-wrapper">
              <div className="empty-state">
                <div className="empty-state-icon">🌤️</div>
                <div className="empty-state-text">今天暂无课程安排，好好休息吧~</div>
              </div>
            </div>
          ) : (
            bookings.map((b) => (
              <div
                key={b.id}
                className={`booking-card ${activeBookingId === b.id ? 'active' : ''}`}
                onClick={() => handleOpenPanel(b)}
              >
                {savedLogIds.has(b.id) && (
                  <div className="booking-log-complete">
                    <Check size={14} strokeWidth={3} />
                  </div>
                )}
                <div className="booking-row">
                  <div className="booking-time-box">
                    <div className="booking-time">{b.startTime}</div>
                    <div className="booking-time-sub">{b.endTime} 下课</div>
                  </div>
                  <div className="booking-details">
                    <div className="booking-student">{b.studentName}</div>
                    <div className="booking-meta">
                      <span className="booking-tag">
                        <Music size={12} />
                        {b.instrument}
                      </span>
                      <span className="booking-tag">
                        <User size={12} />
                        {b.studentPhone}
                      </span>
                      {savedLogIds.has(b.id) && (
                        <span className="booking-tag" style={{ background: '#e8f5e9', color: '#2e7d32' }}>
                          已记录日志
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {activeBooking && !panelClosing && (
          <div className={`log-panel ${panelClosing ? 'slide-out' : ''}`}>
            <div className="log-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="log-panel-title">课程日志</div>
                <div className="log-panel-subtitle">
                  {activeBooking.studentName} · {activeBooking.startTime}-{activeBooking.endTime}
                </div>
              </div>
              <button className="modal-close" onClick={handleClosePanel}>
                <X size={16} />
              </button>
            </div>
            <div className="log-panel-body">
              <div className="form-group">
                <label className="form-label form-label-required">本节课内容</label>
                <textarea
                  className={`form-textarea ${errors.content ? 'error' : ''}`}
                  placeholder="记录本节课教学内容、学生练习情况、知识点讲解等..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  maxLength={500}
                  style={{ minHeight: 120 }}
                />
                <div className={`char-count ${content.length > 500 ? 'over' : ''}`}>
                  {content.length}/500
                </div>
                {errors.content && <div className="form-error">{errors.content}</div>}
              </div>

              <div className="form-group">
                <label className="form-label form-label-required">学生表现评分</label>
                <div className="star-rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className={`star ${n <= rating ? 'filled' : ''} ${clickedStar === n ? 'clicked' : ''}`}
                      onClick={() => handleStarClick(n as 1 | 2 | 3 | 4 | 5)}
                    >
                      ★
                    </span>
                  ))}
                </div>
                {errors.rating && <div className="form-error">{errors.rating}</div>}
              </div>

              <div className="form-group">
                <label className="form-label">课后建议（选填）</label>
                <textarea
                  className="form-textarea"
                  placeholder="给学生的课后练习建议、下节课预习内容等..."
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                  maxLength={300}
                  style={{ minHeight: 80 }}
                />
                <div className="char-count">{suggestion.length}/300</div>
              </div>

              <button
                className="form-submit-btn"
                onClick={validateAndSave}
                disabled={saving}
              >
                {saving ? '保存中...' : '保存课程日志'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
