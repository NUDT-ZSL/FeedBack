import { useApp } from '@/store/AppContext'
import { BOOKING_STATUS_LABELS, CATEGORY_COLORS, CATEGORY_LABELS } from '@/types'
import type { Booking } from '@/types'
import { useState, useEffect, useRef } from 'react'
import { FiShield, FiList, FiAlertTriangle, FiChevronDown, FiChevronUp } from 'react-icons/fi'

const STATUS_BADGE_COLORS: Record<string, string> = {
  pending: '#F5A623',
  active: '#4CAF50',
  completed: '#9E9E9E',
  cancelled: '#E57373',
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN')
}

export default function AdminPanel() {
  const { spaces, bookings, auditLog, forceCancelBooking, refreshBookings, refreshAuditLog } = useApp()

  const [showAll, setShowAll] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null)
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())
  const [statsAnimKey, setStatsAnimKey] = useState(0)
  const prevStatsRef = useRef({ totalSpaces: 0, todayBookings: 0, activeBookings: 0 })

  const today = new Date().toISOString().slice(0, 10)
  const totalSpaces = spaces.length
  const todayBookings = bookings.filter(b => b.startTime?.startsWith(today)).length
  const activeBookings = bookings.filter(b => b.status === 'active').length

  useEffect(() => {
    const prev = prevStatsRef.current
    if (
      prev.totalSpaces !== totalSpaces ||
      prev.todayBookings !== todayBookings ||
      prev.activeBookings !== activeBookings
    ) {
      prevStatsRef.current = { totalSpaces, todayBookings, activeBookings }
      setStatsAnimKey(k => k + 1)
    }
  }, [totalSpaces, todayBookings, activeBookings])

  const spaceMap = useRef(new Map<string, { name: string; category?: string }>())
  spaceMap.current = new Map(spaces.map(s => [s.id, { name: s.name, category: s.category }]))

  const getSpaceName = (spaceId: string) => spaceMap.current.get(spaceId)?.name ?? '未知空间'
  const getSpaceCategoryColor = (spaceId: string) => {
    const cat = spaceMap.current.get(spaceId)?.category
    return cat ? CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] : '#D7CCC8'
  }

  const handleConfirmCancel = async () => {
    if (!confirmTarget) return
    const id = confirmTarget.id
    setFadingIds(prev => new Set(prev).add(id))
    setConfirmTarget(null)

    await forceCancelBooking(id)

    setTimeout(() => {
      setFadingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      refreshBookings()
      refreshAuditLog()
    }, 400)
  }

  const displayedBookings = showAll ? bookings : bookings.slice(0, 10)

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes statFlash {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <FiShield size={24} color="#C4956A" />
        <h2 style={{ margin: 0, color: '#5D4037', fontSize: 22 }}>管理面板</h2>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        {[
          { label: '空间总数', value: totalSpaces },
          { label: '今日预定', value: todayBookings },
          { label: '使用中', value: activeBookings },
        ].map((card, i) => (
          <div
            key={card.label}
            style={{
              flex: '1 1 200px',
              background: '#F5E6CC',
              borderRadius: 12,
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 14, color: '#8D6E63', marginBottom: 4 }}>{card.label}</div>
            <span
              key={`${i}-${statsAnimKey}`}
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: '#5D4037',
                display: 'inline-block',
                animation: 'statFlash 0.2s ease-in-out',
              }}
            >
              {card.value}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FiList size={18} color="#8D6E63" />
          <h3 style={{ margin: 0, color: '#5D4037', fontSize: 18 }}>预定列表</h3>
        </div>

        {displayedBookings.map(booking => {
          const isFading = fadingIds.has(booking.id)
          return (
            <div
              key={booking.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#FFF8F0',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 8,
                borderLeft: `4px solid ${getSpaceCategoryColor(booking.spaceId)}`,
                opacity: isFading ? 0 : 1,
                transform: isFading ? 'translateX(-20px)' : 'none',
                transition: 'opacity 0.4s ease, transform 0.4s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: '#5D4037', fontWeight: 500, minWidth: 80 }}>
                  {booking.userId}
                </span>
                <span style={{ fontSize: 14, color: '#8D6E63' }}>
                  {getSpaceName(booking.spaceId)}
                </span>
                <span style={{ fontSize: 13, color: '#A1887F' }}>
                  {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    padding: '2px 10px',
                    borderRadius: 10,
                    background: STATUS_BADGE_COLORS[booking.status] ?? '#BDBDBD',
                    color: '#fff',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {BOOKING_STATUS_LABELS[booking.status]}
                </span>
              </div>

              {booking.status !== 'cancelled' && booking.status !== 'completed' && (
                <button
                  onClick={() => setConfirmTarget(booking)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: '#E53935',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    marginLeft: 8,
                  }}
                >
                  <FiAlertTriangle size={14} />
                  强制取消
                </button>
              )}
            </div>
          )
        })}

        {bookings.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              width: '100%',
              background: 'transparent',
              border: '1px dashed #D7CCC8',
              borderRadius: 8,
              padding: 8,
              color: '#8D6E63',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {showAll ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
            {showAll ? '收起' : '查看更多'}
          </button>
        )}
      </div>

      {confirmTarget && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#FFF8F0',
              borderRadius: 12,
              padding: 24,
              minWidth: 320,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <FiAlertTriangle size={20} color="#E53935" />
              <span style={{ fontSize: 16, fontWeight: 600, color: '#5D4037' }}>确认操作</span>
            </div>
            <p style={{ margin: '0 0 20px', color: '#8D6E63', fontSize: 14, lineHeight: 1.6 }}>
              确定要强制取消此预定吗？
              <br />
              <strong>{getSpaceName(confirmTarget.spaceId)}</strong> ·{' '}
              {formatTime(confirmTarget.startTime)}-{formatTime(confirmTarget.endTime)}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setConfirmTarget(null)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  border: '1px solid #D7CCC8',
                  background: '#fff',
                  color: '#8D6E63',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmCancel}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#E53935',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                确定取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <FiShield size={18} color="#8D6E63" />
          <h3 style={{ margin: 0, color: '#5D4037', fontSize: 18 }}>操作日志</h3>
        </div>

        {auditLog.length === 0 && (
          <div style={{ color: '#A1887F', fontSize: 14, padding: '12px 0' }}>暂无操作记录</div>
        )}

        {auditLog.map(log => (
          <div
            key={log.id}
            style={{
              padding: '8px 12px',
              marginBottom: 4,
              fontSize: 13,
              color: '#8D6E63',
              borderBottom: '1px solid #EFEBE9',
            }}
          >
            <span style={{ color: '#A1887F', marginRight: 8 }}>{formatDateTime(log.timestamp)}</span>
            <span style={{ fontWeight: 500 }}>{log.action}</span>
            <span style={{ color: '#A1887F', marginLeft: 8 }}>预定 #{log.targetBookingId}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
