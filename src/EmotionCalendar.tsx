import React, { useState } from 'react'
import { EMOTION_CONFIGS } from './EmotionAnalyzer'

interface DayData {
  date: string
  hasEntry: boolean
  dominantEmotion?: 'joy' | 'sadness' | 'anger' | 'peace'
  emotionRatios?: Record<string, number>
}

const mockHistoryData: Record<string, DayData> = {}

const emotions: Array<'joy' | 'sadness' | 'anger' | 'peace'> = ['joy', 'sadness', 'anger', 'peace']

const today = new Date()
for (let i = 0; i < 60; i++) {
  const date = new Date(today)
  date.setDate(date.getDate() - i)
  const dateStr = date.toISOString().split('T')[0]
  if (Math.random() > 0.3) {
    const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)]
    const ratios: Record<string, number> = {}
    emotions.forEach(e => {
      ratios[e] = Math.random()
    })
    const sum = Object.values(ratios).reduce((a, b) => a + b, 0)
    Object.keys(ratios).forEach(k => { ratios[k] /= sum })
    mockHistoryData[dateStr] = {
      date: dateStr,
      hasEntry: true,
      dominantEmotion: randomEmotion,
      emotionRatios: ratios
    }
  } else {
    mockHistoryData[dateStr] = { date: dateStr, hasEntry: false }
  }
}

const EmotionCalendar: React.FC = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startWeekday = firstDay.getDay()
  const totalDays = lastDay.getDate()

  const days: Array<{ day: number | null; dateStr?: string }> = []
  for (let i = 0; i < startWeekday; i++) {
    days.push({ day: null })
  }
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = new Date(year, month, d).toISOString().split('T')[0]
    days.push({ day: d, dateStr })
  }

  const prevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1))
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1))
  }

  const getColorForEmotion = (emotion?: string) => {
    if (!emotion) return 'rgba(255, 255, 255, 0.05)'
    const conf = EMOTION_CONFIGS[emotion]
    return conf ? conf.color : 'rgba(255, 255, 255, 0.05)'
  }

  const getGradientForEmotion = (emotion?: string) => {
    if (!emotion) return 'rgba(255, 255, 255, 0.05)'
    const conf = EMOTION_CONFIGS[emotion]
    if (!conf) return 'rgba(255, 255, 255, 0.05)'
    return `linear-gradient(135deg, ${conf.gradient[0]}40 0%, ${conf.gradient[1]}25 50%, ${conf.gradient[2]}10 100%)`
  }

  return (
    <div style={{ padding: '32px', height: '100%', overflowY: 'auto' }}>
      <h2 style={{ color: '#ffffff', fontSize: '24px', margin: 0, marginBottom: '24px', fontWeight: 700 }}>
        情绪日历
      </h2>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px'
      }}>
        <button
          onClick={prevMonth}
          style={{
            background: 'none',
            border: 'none',
            color: '#cba6f7',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px 16px',
            borderRadius: '8px',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(203, 166, 247, 0.15)' }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'none' }}
        >
          ←
        </button>
        <div style={{ color: '#ffffff', fontSize: '18px', fontWeight: 600 }}>
          {year}年{month + 1}月
        </div>
        <button
          onClick={nextMonth}
          style={{
            background: 'none',
            border: 'none',
            color: '#cba6f7',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px 16px',
            borderRadius: '8px',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(203, 166, 247, 0.15)' }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'none' }}
        >
          →
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '8px',
        marginBottom: '12px'
      }}>
        {['日', '一', '二', '三', '四', '五', '六'].map(w => (
          <div
            key={w}
            style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '13px',
              padding: '8px',
              fontWeight: 500
            }}
          >
            {w}
          </div>
        ))}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '8px'
      }}>
        {days.map((d, idx) => {
          if (d.day === null) {
            return <div key={idx} style={{ aspectRatio: '1' }} />
          }
          const dayData = d.dateStr ? mockHistoryData[d.dateStr] : null
          const isSelected = selectedDay?.date === d.dateStr
          const isToday = d.dateStr === today.toISOString().split('T')[0]

          return (
            <div
              key={idx}
              onClick={() => dayData?.hasEntry && setSelectedDay(dayData)}
              style={{
                aspectRatio: '1',
                background: dayData?.hasEntry ? getGradientForEmotion(dayData.dominantEmotion) : 'rgba(255,255,255,0.02)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: dayData?.hasEntry ? 'pointer' : 'default',
                position: 'relative',
                border: isSelected ? `2px solid ${getColorForEmotion(dayData?.dominantEmotion)}` : '2px solid transparent',
                transition: 'all 0.2s ease',
                boxSizing: 'border-box'
              }}
              onMouseOver={(e) => {
                if (dayData?.hasEntry) {
                  e.currentTarget.style.transform = 'scale(1.05)'
                  e.currentTarget.style.boxShadow = `0 4px 20px ${getColorForEmotion(dayData.dominantEmotion)}40`
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <span style={{
                color: dayData?.hasEntry ? '#ffffff' : 'rgba(255,255,255,0.3)',
                fontSize: '14px',
                fontWeight: dayData?.hasEntry ? 600 : 400
              }}>
                {d.day}
              </span>
              {isToday && (
                <div style={{
                  position: 'absolute',
                  bottom: '4px',
                  width: '4px',
                  height: '4px',
                  background: '#cba6f7',
                  borderRadius: '50%'
                }} />
              )}
            </div>
          )
        })}
      </div>

      <div style={{
        display: 'flex',
        gap: '20px',
        marginTop: '32px',
        padding: '16px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
        justifyContent: 'center'
      }}>
        {Object.entries(EMOTION_CONFIGS).map(([key, conf]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '14px',
              height: '14px',
              background: conf.color,
              borderRadius: '4px'
            }} />
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
              {conf.name}
            </span>
          </div>
        ))}
      </div>

      {selectedDay && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease'
          }}
          onClick={() => setSelectedDay(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e1e2e',
              padding: '32px',
              borderRadius: '20px',
              minWidth: '360px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ color: '#ffffff', margin: 0, fontSize: '20px' }}>
                {selectedDay.date}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '20px',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>

            {selectedDay.emotionRatios && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {Object.entries(selectedDay.emotionRatios)
                  .sort(([, a], [, b]) => b - a)
                  .map(([emotion, ratio]) => {
                    const conf = EMOTION_CONFIGS[emotion]
                    return (
                      <div key={emotion}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span style={{ color: '#ffffff', fontSize: '14px' }}>{conf?.name || emotion}</span>
                          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                            {(ratio * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div style={{
                          height: '10px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '5px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            background: `linear-gradient(90deg, ${conf?.gradient[0] || '#89b4fa'}, ${conf?.gradient[1] || '#cba6f7'})`,
                            width: `${ratio * 100}%`,
                            borderRadius: '5px',
                            transition: 'width 0.5s ease-out'
                          }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes slideUp {
              from { opacity: 0; transform: translateY(20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

export default EmotionCalendar
