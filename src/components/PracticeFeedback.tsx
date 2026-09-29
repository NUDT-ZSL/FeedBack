import { useState, useEffect } from 'react'
import { CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import type { LessonLog, PracticeFeedbackItem, DURATION_OPTIONS } from '../types'
import { api } from '../services/api'

const RATING_TEXT: Record<number, string> = {
  1: '需要加强练习',
  2: '有待进步',
  3: '表现一般',
  4: '表现良好',
  5: '非常优秀'
}

export default function PracticeFeedback() {
  const [logs, setLogs] = useState<LessonLog[]>([])
  const [loading, setLoading] = useState(true)
  const [openFormLogId, setOpenFormLogId] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set())

  const [feedbackTexts, setFeedbackTexts] = useState<Record<string, string>>({})
  const [durations, setDurations] = useState<Record<string, number>>({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const data = await api.getAllRecentLogs()
      setLogs(data)
      setLoading(false)
    }
    load()
  }, [])

  const handleSubmit = async (log: LessonLog) => {
    const text = (feedbackTexts[log.id] || '').trim()
    const duration = durations[log.id]
    if (!text) {
      toast.error('请填写练习反馈内容')
      return
    }
    if (text.length > 500) {
      toast.error('反馈内容不能超过500字')
      return
    }
    if (!duration) {
      toast.error('请选择练习时长')
      return
    }
    try {
      await api.submitFeedback({
        logId: log.id,
        studentName: log.studentName,
        feedbackText: text,
        duration: duration as 15 | 30 | 45 | 60
      })
      setSubmittedIds((prev) => new Set(prev).add(log.id))
      setOpenFormLogId(null)
      toast.success('反馈已提交，继续加油练习！')
    } catch {
      toast.error('提交失败，请重试')
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return {
      day: d.getDate(),
      month: `${d.getMonth() + 1}月`
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">课后练习反馈</h1>
          <p className="page-subtitle">记录您的练习情况，帮助老师了解学习进度</p>
        </div>
        <div className="schedule-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon">🎼</div>
            <div className="empty-state-text">正在加载课程记录...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">课后练习反馈</h1>
        <p className="page-subtitle">记录您的练习情况，帮助老师了解学习进度</p>
      </div>

      <div className="feedback-section-title">最近课程日志</div>

      {logs.length === 0 ? (
        <div className="schedule-wrapper">
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <div className="empty-state-text">暂无课程记录，请先预约课程</div>
          </div>
        </div>
      ) : (
        logs.map((log) => {
          const dateInfo = formatDate(log.date)
          const isFormOpen = openFormLogId === log.id
          const isSubmitted = submittedIds.has(log.id)
          const feedbackText = feedbackTexts[log.id] || ''

          return (
            <div key={log.id} className="log-summary-card">
              <div className="log-summary-header">
                <div className="log-summary-left">
                  <div className="log-date-badge">
                    <div className="log-date-day">{dateInfo.day}</div>
                    <div className="log-date-month">{dateInfo.month}</div>
                  </div>
                  <div className="log-summary-info">
                    <div className="log-summary-teacher">
                      {log.studentName} · {RATING_TEXT[log.rating] || '未评价'}
                    </div>
                    <div className="log-summary-eval" style={{ marginTop: 6 }}>
                      <div className="log-summary-stars" style={{ marginBottom: 4 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className={`star ${n <= log.rating ? 'filled' : ''}`}>
                            ★
                          </span>
                        ))}
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: '#6b5b4e',
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {log.content}
                      </div>
                    </div>
                  </div>
                </div>
                {isSubmitted ? (
                  <div className="feedback-submitted-tag">
                    <CheckCircle size={14} />
                    反馈已提交
                  </div>
                ) : (
                  <button
                    className="feedback-expand-btn"
                    onClick={() => setOpenFormLogId(isFormOpen ? null : log.id)}
                  >
                    {isFormOpen ? '收起' : '提交反馈'}
                  </button>
                )}
              </div>

              {!isSubmitted && (
                <div className={`feedback-form ${isFormOpen ? 'open' : ''}`}>
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label form-label-required">我的练习反馈</label>
                    <textarea
                      className="form-textarea"
                      placeholder="分享您的课后练习心得、遇到的困难、进步的地方..."
                      value={feedbackText}
                      onChange={(e) => setFeedbackTexts((prev) => ({
                        ...prev,
                        [log.id]: e.target.value
                      }))}
                      maxLength={500}
                      style={{ minHeight: 90 }}
                    />
                    <div className={`char-count ${feedbackText.length > 500 ? 'over' : ''}`}>
                      {feedbackText.length}/500
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label form-label-required">练习时长</label>
                    <div className="duration-options">
                      {([15, 30, 45, 60] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`duration-btn ${durations[log.id] === d ? 'selected' : ''}`}
                          onClick={() => setDurations((prev) => ({
                            ...prev,
                            [log.id]: d
                          }))}
                        >
                          {d} 分钟
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="feedback-submit-btn"
                    onClick={() => handleSubmit(log)}
                  >
                    提交练习反馈
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
