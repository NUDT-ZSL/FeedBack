import { useApp } from '@/store/AppContext'
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_LABELS as CL } from '@/types'
import type { Space, Booking } from '@/types'
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import { FiClock, FiBarChart2, FiArrowLeft } from 'react-icons/fi'
import toast from 'react-hot-toast'

const PRIMARY = '#F5E6CC'
const SECONDARY = '#D4A574'
const ACCENT = '#2E8B57'

const CATEGORY_ICONS: Record<string, string> = {
  garden: '🌿',
  fitness: '💪',
  reading: '📚',
  vacant: '🏠',
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const PIE_PALETTE = ['#2E8B57', '#D4A574', '#A8E6CF', '#FFD3B6', '#D4A5A5', '#8FBC8F', '#DEB887']

function slotLabel(idx: number): string {
  const h = 8 + Math.floor(idx / 2)
  const m = idx % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
}

function slotDate(idx: number, base: Date): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setHours(8 + Math.floor(idx / 2), idx % 2 === 0 ? 0 : 30, 0, 0)
  return d
}

function endLabel(idx: number): string {
  if (idx >= 24) return '20:00'
  return slotLabel(idx)
}

export default function SpaceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { spaces, bookings, currentUser, createBooking } = useApp()

  const [activeTab, setActiveTab] = useState(0)
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const [tooltipInfo, setTooltipInfo] = useState<{ x: number; y: number; booking: Booking } | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [formStartIdx, setFormStartIdx] = useState(0)
  const [formEndIdx, setFormEndIdx] = useState(2)
  const [formPurpose, setFormPurpose] = useState('')
  const [chartAnimated, setChartAnimated] = useState(false)
  const [pieAnimated, setPieAnimated] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const style = document.createElement('style')
    style.id = 'space-detail-keyframes'
    style.textContent = `
      @keyframes toastSlideShake {
        0% { transform: translateY(20px); opacity: 0; }
        60% { transform: translateY(-3px); opacity: 1; }
        80% { transform: translateY(1px); }
        100% { transform: translateY(0); opacity: 1; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('space-detail-keyframes')?.remove() }
  }, [])

  useEffect(() => {
    if (activeTab === 1) {
      const t1 = setTimeout(() => setChartAnimated(true), 80)
      const t2 = setTimeout(() => setPieAnimated(true), 400)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    setChartAnimated(false)
    setPieAnimated(false)
  }, [activeTab])

  const space = spaces.find(s => s.id === id)
  const categoryColor = space ? CATEGORY_COLORS[space.category] : SECONDARY
  const categoryLabel = space ? CL[space.category] : ''
  const categoryIcon = space ? CATEGORY_ICONS[space.category] || '' : ''

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const todayBookings = useMemo(() => {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return bookings.filter(b => {
      if (b.spaceId !== id || b.status === 'cancelled') return false
      const s = new Date(b.startTime)
      return s >= today && s < tomorrow
    })
  }, [bookings, id, today])

  const slots = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const sStart = slotDate(i, today)
      const sEnd = new Date(sStart.getTime() + 30 * 60000)
      const booking = todayBookings.find(b => {
        const bS = new Date(b.startTime)
        const bE = new Date(b.endTime)
        return sStart < bE && sEnd > bS
      })
      return { label: slotLabel(i), booking, isPending: booking?.status === 'pending' }
    })
  }, [todayBookings, today])

  const barData = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const offset = 6 - i
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      day.setDate(day.getDate() - offset)
      const nextDay = new Date(day)
      nextDay.setDate(nextDay.getDate() + 1)
      const count = bookings.filter(b => {
        if (b.spaceId !== id || b.status === 'cancelled') return false
        const s = new Date(b.startTime)
        return s >= day && s < nextDay
      }).length
      return { label: `周${WEEKDAYS[day.getDay()]}`, count }
    })
  }, [bookings, id])

  const pieData = useMemo(() => {
    const map: Record<string, number> = {}
    bookings.filter(b => b.spaceId === id && b.status !== 'cancelled').forEach(b => {
      map[b.purpose] = (map[b.purpose] || 0) + 1
    })
    return Object.entries(map).map(([purpose, count]) => ({ purpose, count }))
  }, [bookings, id])

  const handleSlotClick = (idx: number) => {
    if (slots[idx].booking) return
    setFormStartIdx(idx)
    setFormEndIdx(Math.min(idx + 2, 24))
    setFormPurpose('')
    setModalOpen(true)
  }

  const maxEndIdx = Math.min(formStartIdx + 4, 24)

  const handleSubmit = async () => {
    if (!formPurpose.trim()) return
    const base = new Date()
    const startDate = slotDate(formStartIdx, base)
    const endDate = formEndIdx >= 24
      ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), 20, 0, 0)
      : slotDate(formEndIdx, base)
    try {
      await createBooking(id!, startDate.toISOString(), endDate.toISOString(), formPurpose)
      setModalOpen(false)
      toast.success('预定成功！', {
        duration: 2000,
        style: {
          background: ACCENT,
          color: '#fff',
          animation: 'toastSlideShake 0.3s ease-out',
        },
      })
    } catch (e: any) {
      toast.error(e.message || '预定失败')
    }
  }

  if (!space) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ color: SECONDARY, fontSize: 16 }}>未找到该空间</p>
        <button onClick={() => navigate(-1)} style={{ ...styles.backBtn, position: 'static', marginTop: 16, width: 'auto', padding: '8px 20px' }}>返回</button>
      </div>
    )
  }

  const barMax = Math.max(...barData.map(d => d.count), 1)
  const barW = 36
  const barGap = 16
  const chartW = barData.length * (barW + barGap)
  const chartH = 150

  const pieTotal = pieData.reduce((s, d) => s + d.count, 0) || 1
  const pieR = 60
  const pieC = 2 * Math.PI * pieR

  const renderBarChart = () => (
    <svg viewBox={`0 0 ${chartW + 40} ${chartH + 40}`} style={{ width: '100%', maxWidth: 500 }}>
      {barData.map((d, i) => {
        const h = (d.count / barMax) * chartH
        const x = 20 + i * (barW + barGap)
        const y = chartH - h + 10
        return (
          <g key={i}>
            <rect
              x={x} y={chartH + 10}
              width={barW} height={h}
              rx={4}
              fill={i === barData.length - 1 ? ACCENT : SECONDARY}
              style={{
                transform: chartAnimated ? 'scaleY(1)' : 'scaleY(0)',
                transformOrigin: `${x + barW / 2}px ${chartH + 10}px`,
                transition: `transform 0.3s ease ${i * 0.08}s`,
              }}
            />
            <text x={x + barW / 2} y={chartH + 30} textAnchor="middle" fill="#888" fontSize="11">{d.label}</text>
            {chartAnimated && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="#666" fontSize="11">{d.count}</text>
            )}
          </g>
        )
      })}
    </svg>
  )

  const renderPieChart = () => {
    let offset = 0
    return (
      <svg viewBox="0 0 200 200" style={{ width: '100%', maxWidth: 240 }}>
        {pieData.map((d, i) => {
          const pct = d.count / pieTotal
          const targetDash = pct * pieC
          const dash = pieAnimated ? targetDash : 0
          const dashOffset = -offset * pieC
          offset += pct
          return (
            <circle
              key={i}
              cx="100" cy="100" r={pieR}
              fill="none"
              stroke={PIE_PALETTE[i % PIE_PALETTE.length]}
              strokeWidth="30"
              strokeDasharray={`${dash} ${pieC}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 100 100)"
              style={{ transition: `stroke-dasharray 0.4s ease ${i * 0.1}s` }}
            />
          )
        })}
        <circle cx="100" cy="100" r={pieR - 15} fill="#fff" />
        <text x="100" y="96" textAnchor="middle" fill="#666" fontSize="11">总使用</text>
        <text x="100" y="112" textAnchor="middle" fill="#333" fontSize="14" fontWeight="600">{pieTotal}</text>
      </svg>
    )
  }

  return (
    <div style={styles.container}>
      <div style={{
        ...styles.heroArea,
        background: `linear-gradient(135deg, ${categoryColor}, ${categoryColor}88, ${PRIMARY})`,
      }}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>
          <FiArrowLeft size={20} />
        </button>
        <div style={styles.heroIcon}>{categoryIcon}</div>
        <div style={styles.heroName}>{space.name}</div>
        <div style={styles.heroCategory}>{CATEGORY_LABELS[space.category]}</div>
      </div>

      <div style={isMobile ? styles.tabsStrip : styles.tabsRow}>
        {[
          { label: '预定时间表', icon: <FiClock style={{ marginRight: 6 }} /> },
          { label: '历史使用统计', icon: <FiBarChart2 style={{ marginRight: 6 }} /> },
        ].map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            style={{
              ...(isMobile ? styles.tabBtnMobile : styles.tabBtn),
              color: activeTab === i ? ACCENT : '#888',
              borderBottom: activeTab === i ? `2px solid ${ACCENT}` : '2px solid transparent',
            }}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <div style={styles.tabContentWrapper}>
        <div style={{ ...styles.tabSlider, transform: `translateX(${-activeTab * 100}%)` }}>
          <div style={styles.tabPanel}>
            {slots.map((slot, i) => {
              const booked = !!slot.booking
              const bg = booked
                ? (slot.isPending ? `${categoryColor}99` : categoryColor)
                : '#fff'
              return (
                <div
                  key={i}
                  style={{ ...styles.slotRow, backgroundColor: bg, cursor: booked ? 'default' : 'pointer' }}
                  onClick={() => handleSlotClick(i)}
                  onMouseEnter={e => {
                    if (booked) {
                      const r = e.currentTarget.getBoundingClientRect()
                      setTooltipInfo({ x: r.right + 8, y: r.top, booking: slot.booking! })
                      setHoveredSlot(i)
                    }
                  }}
                  onMouseLeave={() => { setTooltipInfo(null); setHoveredSlot(null) }}
                >
                  <span style={styles.slotTime}>{slot.label}</span>
                  {booked && <span style={styles.slotUser}>{slot.booking!.userId}</span>}
                  {!booked && <span style={styles.slotEmpty}>可预定</span>}
                </div>
              )
            })}
          </div>

          <div style={styles.tabPanel}>
            <h3 style={styles.chartTitle}>近7天使用次数</h3>
            <div style={styles.chartBox}>{renderBarChart()}</div>
            <h3 style={{ ...styles.chartTitle, marginTop: 28 }}>使用目的分布</h3>
            <div style={styles.chartBox}>{renderPieChart()}</div>
            <div style={styles.legendWrap}>
              {pieData.map((d, i) => (
                <div key={i} style={styles.legendItem}>
                  <span style={{ ...styles.legendDot, backgroundColor: PIE_PALETTE[i % PIE_PALETTE.length] }} />
                  <span style={styles.legendText}>{d.purpose} ({d.count})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tooltipInfo && hoveredSlot !== null && (
        <div style={{ ...styles.tooltip, left: tooltipInfo.x, top: tooltipInfo.y }}>
          <div style={{ fontWeight: 600 }}>
            {new Date(tooltipInfo.booking.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            {' - '}
            {new Date(tooltipInfo.booking.endTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style={{ color: ACCENT, marginTop: 4, fontSize: 12 }}>{tooltipInfo.booking.purpose}</div>
          <div style={{ color: '#aaa', marginTop: 2, fontSize: 11 }}>{tooltipInfo.booking.userId}</div>
        </div>
      )}

      {modalOpen && (
        <div style={styles.modalOverlay} onClick={() => setModalOpen(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>预定时间段</h3>
            <div style={styles.formGroup}>
              <label style={styles.label}>开始时间</label>
              <select
                value={formStartIdx}
                onChange={e => {
                  const idx = Number(e.target.value)
                  setFormStartIdx(idx)
                  if (formEndIdx < idx + 1) setFormEndIdx(idx + 1)
                  if (formEndIdx > idx + 4) setFormEndIdx(idx + 4)
                }}
                style={styles.select}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i} disabled={!!slots[i]?.booking}>{slotLabel(i)}</option>
                ))}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>结束时间（最长2小时）</label>
              <select value={formEndIdx} onChange={e => setFormEndIdx(Number(e.target.value))} style={styles.select}>
                {Array.from({ length: maxEndIdx - formStartIdx }, (_, i) => {
                  const idx = formStartIdx + i + 1
                  return <option key={idx} value={idx}>{endLabel(idx)}</option>
                })}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>使用目的（最多50字）</label>
              <input
                type="text"
                maxLength={50}
                value={formPurpose}
                onChange={e => setFormPurpose(e.target.value)}
                placeholder="请输入使用目的"
                style={styles.input}
              />
              <span style={styles.charCount}>{formPurpose.length}/50</span>
            </div>
            <div style={styles.modalBtns}>
              <button onClick={() => setModalOpen(false)} style={styles.cancelBtn}>取消</button>
              <button onClick={handleSubmit} disabled={!formPurpose.trim()} style={{
                ...styles.submitBtn,
                opacity: formPurpose.trim() ? 1 : 0.5,
                cursor: formPurpose.trim() ? 'pointer' : 'not-allowed',
              }}>确认预定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: PRIMARY,
    position: 'relative',
    paddingBottom: 32,
  },
  heroArea: {
    position: 'relative',
    height: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0 0 24px 24px',
    overflow: 'hidden',
  },
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    background: 'rgba(255,255,255,0.65)',
    border: 'none',
    borderRadius: 20,
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#333',
    backdropFilter: 'blur(4px)',
  },
  heroIcon: { fontSize: 52, marginBottom: 8 },
  heroName: { fontSize: 22, fontWeight: 700, color: '#333' },
  heroCategory: { fontSize: 14, color: '#555', marginTop: 4 },
  tabsRow: {
    display: 'flex',
    justifyContent: 'center',
    backgroundColor: '#fff',
    margin: '12px 16px',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tabsStrip: {
    display: 'flex',
    overflowX: 'auto',
    backgroundColor: '#fff',
    margin: '12px 16px',
    borderRadius: 12,
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
  },
  tabBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 0',
    border: 'none',
    background: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color 0.2s, border-color 0.2s',
  },
  tabBtnMobile: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 20px',
    border: 'none',
    background: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'color 0.2s, border-color 0.2s',
  },
  tabContentWrapper: { overflow: 'hidden', margin: '0 16px' },
  tabSlider: { display: 'flex', transition: 'transform 0.3s ease' },
  tabPanel: { minWidth: '100%', flexShrink: 0, backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  slotRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 8,
    marginBottom: 4,
    transition: 'background-color 0.2s',
  },
  slotTime: { fontSize: 13, color: '#555', width: 48, flexShrink: 0, fontWeight: 500 },
  slotUser: { fontSize: 12, color: '#333', fontWeight: 600, marginLeft: 12 },
  slotEmpty: { fontSize: 12, color: '#bbb', marginLeft: 12 },
  tooltip: {
    position: 'fixed',
    backgroundColor: '#333',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    zIndex: 1000,
    pointerEvents: 'none',
    maxWidth: 200,
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  chartTitle: { fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 12 },
  chartBox: { display: 'flex', justifyContent: 'center' },
  legendWrap: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  legendText: { fontSize: 12, color: '#555' },
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#333', marginBottom: 20 },
  formGroup: { marginBottom: 16, position: 'relative' },
  label: { display: 'block', fontSize: 13, color: '#666', marginBottom: 4 },
  select: {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, backgroundColor: '#fff',
  },
  input: {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' as const,
  },
  charCount: { position: 'absolute', right: 8, bottom: 8, fontSize: 11, color: '#999' },
  modalBtns: { display: 'flex', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, padding: '10px 0', border: '1px solid #ddd', borderRadius: 8, background: '#fff', color: '#666', cursor: 'pointer', fontSize: 14,
  },
  submitBtn: {
    flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, background: ACCENT, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  },
}
