import { useState } from 'react'
import type { SelectedSlot, InstrumentType } from '../types'
import { INSTRUMENT_OPTIONS } from '../types'
import { X, ChevronRight } from 'lucide-react'
import { api } from '../services/api'
import toast from 'react-hot-toast'

interface Props {
  slot: SelectedSlot
  teacherName: string
  onClose: () => void
  onSuccess: () => void
}

export default function BookingForm({ slot, teacherName, onClose, onSuccess }: Props) {
  const [studentName, setStudentName] = useState('')
  const [studentPhone, setStudentPhone] = useState('')
  const [instrument, setInstrument] = useState<InstrumentType | ''>('')
  const [selectOpen, setSelectOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; phone?: string; ins?: string }>({})

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    const name = studentName.trim()
    if (!name) newErrors.name = '请输入学生姓名'
    else if (name.length < 3 || name.length > 20) newErrors.name = '姓名长度需在3-20字之间'
    const phone = studentPhone.trim()
    if (!phone) newErrors.phone = '请输入联系方式'
    else if (!/^1[3-9]\d{9}$/.test(phone)) newErrors.phone = '请输入正确的11位手机号'
    if (!instrument) newErrors.ins = '请选择乐器类型'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    if (!instrument) return
    setSubmitting(true)
    try {
      await api.submitBooking(slot, {
        studentName: studentName.trim(),
        studentPhone: studentPhone.trim(),
        instrument
      })
      toast.success('预约成功！老师会尽快确认您的课程')
      onSuccess()
      onClose()
    } catch (err) {
      toast.error('预约失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">预约一对一课程</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="slot-info-box">
            <div className="slot-info-line">
              授课老师：<strong>{teacherName}</strong>
            </div>
            <div className="slot-info-line">
              上课时间：<strong>{slot.date}</strong>
            </div>
            <div className="slot-info-line">
              时段：<strong>{slot.startTime} - {slot.endTime}</strong>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label form-label-required">学生姓名</label>
              <input
                className={`form-input ${errors.name ? 'error' : ''}`}
                type="text"
                placeholder="请输入学生姓名（3-20字）"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                maxLength={20}
              />
              {errors.name && <div className="form-error">{errors.name}</div>}
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">联系方式</label>
              <input
                className={`form-input ${errors.phone ? 'error' : ''}`}
                type="tel"
                placeholder="请输入11位手机号码"
                value={studentPhone}
                onChange={(e) => setStudentPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              />
              {errors.phone && <div className="form-error">{errors.phone}</div>}
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">乐器类型</label>
              <div
                className={`form-select-wrap ${selectOpen ? 'open' : ''} ${errors.ins ? 'error' : ''}`}
                onClick={() => setSelectOpen(!selectOpen)}
              >
                <select
                  className="form-select"
                  value={instrument}
                  onChange={(e) => {
                    setInstrument(e.target.value as InstrumentType | '')
                    setSelectOpen(false)
                  }}
                  onBlur={() => setSelectOpen(false)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="" disabled>请选择乐器类型</option>
                  {INSTRUMENT_OPTIONS.map((ins) => (
                    <option key={ins} value={ins}>{ins}</option>
                  ))}
                </select>
                <ChevronRight size={16} className="form-select-arrow" />
              </div>
              {errors.ins && <div className="form-error">{errors.ins}</div>}
            </div>

            <button
              type="submit"
              className="form-submit-btn"
              disabled={submitting}
            >
              {submitting ? '提交中...' : '确认预约'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
