import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Eye, Thermometer, Wind, Sliders, X } from 'lucide-react'
import { eventBus, type CityData, type ColorMode, type DisplayMode, type MonthlyData } from './EventBus'
import { dataManager } from './DataManager'

const TOTAL_MONTHS = 60
const START_YEAR = 2020

function monthIndexToLabel(index: number): string {
  const year = START_YEAR + Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

interface CityPopupProps {
  city: CityData | null
  monthIndex: number
  onClose: () => void
}

function CityPopup({ city, monthIndex, onClose }: CityPopupProps) {
  if (!city) return null
  const data = city.monthlyData[monthIndex]

  const popupStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(18,18,18,0.85)',
    borderRadius: '12px',
    padding: '16px',
    width: '280px',
    zIndex: 20,
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(0,188,212,0.2)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  }

  return (
    <div style={popupStyle} className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ color: '#FFFFFF', fontSize: '18px', fontWeight: 'bold' }}>{city.name}</div>
          <div style={{ color: '#00BCD4', fontSize: '12px', marginTop: '2px' }}>
            {city.lat.toFixed(2)}°, {city.lng.toFixed(2)}°
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: '#E0E0E0',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '16px' }}>
        <span style={{ color: '#FF5252', fontSize: '24px', fontWeight: 'bold' }}>{data?.aqi ?? 0}</span>
        <span style={{ color: '#E0E0E0', fontSize: '12px' }}>AQI</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#00BCD4', fontSize: '16px', fontWeight: 'bold' }}>{data?.pm25 ?? 0}</div>
          <div style={{ color: '#E0E0E0', fontSize: '11px', opacity: 0.7 }}>PM2.5</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#00BCD4', fontSize: '16px', fontWeight: 'bold' }}>{data?.pm10 ?? 0}</div>
          <div style={{ color: '#E0E0E0', fontSize: '11px', opacity: 0.7 }}>PM10</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#FF9800', fontSize: '16px', fontWeight: 'bold' }}>{data?.temperature ?? 0}°</div>
          <div style={{ color: '#E0E0E0', fontSize: '11px', opacity: 0.7 }}>气温</div>
        </div>
      </div>

      <button
        onClick={() => eventBus.emit('details:show', city)}
        style={{
          width: '100%',
          background: '#4A90D9',
          color: '#FFFFFF',
          borderRadius: '6px',
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: '500',
          transition: 'background 0.3s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#357ABD')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#4A90D9')}
      >
        查看详情
      </button>
    </div>
  )
}

interface TrendChartProps {
  cityId: string | null
  monthIndex: number
  width: number
  height: number
}

function TrendChart({ cityId, monthIndex, width, height }: TrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trendData: MonthlyData[] = cityId
    ? dataManager.getCityTrend(cityId)
    : dataManager.getCities()[0]?.monthlyData ?? []

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    const padding = { top: 20, right: 20, bottom: 28, left: 40 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
    }

    ctx.fillStyle = '#E0E0E0'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const value = Math.round(500 - (500 / 4) * i)
      const y = padding.top + (chartHeight / 4) * i
      ctx.fillText(String(value), padding.left - 6, y)
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i < 5; i++) {
      const mi = i * 12
      const x = padding.left + (chartWidth / (TOTAL_MONTHS - 1)) * mi
      ctx.fillText(`${START_YEAR + i}`, x, height - padding.bottom + 6)
    }

    if (trendData.length > 0) {
      ctx.beginPath()
      ctx.strokeStyle = '#00BCD4'
      ctx.lineWidth = 2
      trendData.forEach((d, i) => {
        const x = padding.left + (chartWidth / (TOTAL_MONTHS - 1)) * i
        const y = padding.top + chartHeight - (d.aqi / 500) * chartHeight
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      const currentX = padding.left + (chartWidth / (TOTAL_MONTHS - 1)) * monthIndex
      const currentY = padding.top + chartHeight - ((trendData[monthIndex]?.aqi ?? 0) / 500) * chartHeight
      ctx.beginPath()
      ctx.arc(currentX, currentY, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#FFD54F'
      ctx.fill()
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(currentX, padding.top)
      ctx.lineTo(currentX, height - padding.bottom)
      ctx.strokeStyle = 'rgba(255,213,79,0.4)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, height - padding.bottom)
    ctx.lineTo(width - padding.right, height - padding.bottom)
    ctx.stroke()
  }, [trendData, monthIndex, width, height])

  return <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
}

interface TimelineProps {
  monthIndex: number
  isPlaying: boolean
  playSpeed: number
  onTogglePlay: () => void
  onMonthChange: (index: number) => void
  onSpeedChange: (speed: number) => void
  layout: 'bottom' | 'side'
}

function Timeline({
  monthIndex,
  isPlaying,
  playSpeed,
  onTogglePlay,
  onMonthChange,
  onSpeedChange,
  layout,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const handleTrackClick = (e: React.MouseEvent) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const ratio = layout === 'bottom'
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height
    const index = Math.round(ratio * (TOTAL_MONTHS - 1))
    onMonthChange(Math.max(0, Math.min(TOTAL_MONTHS - 1, index)))
  }

  const handleMouseDown = () => {
    draggingRef.current = true
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const ratio = layout === 'bottom'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height
      const index = Math.round(ratio * (TOTAL_MONTHS - 1))
      onMonthChange(Math.max(0, Math.min(TOTAL_MONTHS - 1, index)))
    }
    const handleMouseUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onMonthChange, layout])

  if (layout === 'bottom') {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          height: '80px',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '12px',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          zIndex: 10,
          backdropFilter: 'blur(10px)',
        }}
      >
        <button
          onClick={onTogglePlay}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: '#FFD54F',
            color: '#1A1A2E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {[0.5, 1, 2].map((speed) => (
            <button
              key={speed}
              onClick={() => onSpeedChange(speed)}
              style={{
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                background: playSpeed === speed ? '#00BCD4' : 'rgba(255,255,255,0.1)',
                color: playSpeed === speed ? '#1A1A2E' : '#E0E0E0',
                transition: 'all 0.2s',
              }}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: '300px' }}>
          <div style={{ color: '#FFD54F', fontSize: '12px', marginBottom: '6px' }}>
            {monthIndexToLabel(monthIndex)}
          </div>
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            style={{
              position: 'relative',
              height: '4px',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${(monthIndex / (TOTAL_MONTHS - 1)) * 100}%`,
                background: 'linear-gradient(90deg, #00BCD4, #FFD54F)',
                borderRadius: '2px',
              }}
            />
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: `calc(${(monthIndex / (TOTAL_MONTHS - 1)) * 100}% - 8px)`,
                top: '-6px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#FFD54F',
                boxShadow: '0 0 12px rgba(255,213,79,0.6)',
                cursor: 'grab',
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100px',
        left: '20px',
        width: '60px',
        background: 'rgba(0,0,0,0.4)',
        borderRadius: '12px',
        padding: '16px 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        zIndex: 10,
        backdropFilter: 'blur(10px)',
      }}
    >
      <button
        onClick={onTogglePlay}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: '#FFD54F',
          color: '#1A1A2E',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <div style={{ color: '#FFD54F', fontSize: '11px', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
        {monthIndexToLabel(monthIndex)}
      </div>

      <div
        ref={trackRef}
        onClick={handleTrackClick}
        style={{
          position: 'relative',
          width: '4px',
          height: '200px',
          background: 'rgba(255,255,255,0.15)',
          borderRadius: '2px',
          cursor: 'pointer',
          flex: 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${(monthIndex / (TOTAL_MONTHS - 1)) * 100}%`,
            background: 'linear-gradient(0deg, #00BCD4, #FFD54F)',
            borderRadius: '2px',
          }}
        />
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            bottom: `calc(${(monthIndex / (TOTAL_MONTHS - 1)) * 100}% - 8px)`,
            left: '-6px',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: '#FFD54F',
            boxShadow: '0 0 12px rgba(255,213,79,0.6)',
            cursor: 'grab',
          }}
        />
      </div>
    </div>
  )
}

interface ControlPanelProps {
  colorMode: ColorMode
  displayMode: DisplayMode
  aqiRange: [number, number]
  onColorModeChange: (mode: ColorMode) => void
  onDisplayModeChange: (mode: DisplayMode) => void
  onAqiRangeChange: (range: [number, number]) => void
  layout: 'vertical' | 'horizontal'
}

function ControlPanel({
  colorMode,
  displayMode,
  aqiRange,
  onColorModeChange,
  onDisplayModeChange,
  onAqiRangeChange,
  layout,
}: ControlPanelProps) {
  const colorModes: { value: ColorMode; icon: React.ReactNode; label: string }[] = [
    { value: 'aqi', icon: <Eye size={14} />, label: 'AQI' },
    { value: 'temperature', icon: <Thermometer size={14} />, label: '温度' },
    { value: 'windSpeed', icon: <Wind size={14} />, label: '风速' },
  ]

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: '#1E293B',
    borderRadius: '8px',
    padding: '12px',
    zIndex: 15,
    display: 'flex',
    gap: '8px',
    ...(layout === 'vertical'
      ? { flexDirection: 'column', width: '200px' }
      : { flexDirection: 'row', alignItems: 'center' }),
  }

  return (
    <div style={panelStyle}>
      <div>
        <div style={{ color: '#E0E0E0', fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>
          <Sliders size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
          颜色模式
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {colorModes.map(({ value, icon, label }) => {
            const active = colorMode === value
            return (
              <button
                key={value}
                onClick={() => onColorModeChange(value)}
                title={label}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: active ? '#00BCD4' : 'rgba(255,255,255,0.1)',
                  color: active ? '#1A1A2E' : '#E0E0E0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.3s',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgba(0,188,212,0.3)'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                }}
              >
                {icon}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{ color: '#E0E0E0', fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>显示模式</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onDisplayModeChange(displayMode === 'bubble' ? 'heatmap' : 'bubble')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              background: displayMode === 'bubble' ? '#00BCD4' : 'rgba(255,255,255,0.1)',
              color: displayMode === 'bubble' ? '#1A1A2E' : '#E0E0E0',
              transition: 'all 0.3s',
            }}
          >
            气泡
          </button>
          <button
            onClick={() => onDisplayModeChange(displayMode === 'heatmap' ? 'bubble' : 'heatmap')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              background: displayMode === 'heatmap' ? '#00BCD4' : 'rgba(255,255,255,0.1)',
              color: displayMode === 'heatmap' ? '#1A1A2E' : '#E0E0E0',
              transition: 'all 0.3s',
            }}
          >
            热力图
          </button>
        </div>
      </div>

      <div>
        <div style={{ color: '#E0E0E0', fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>
          AQI 筛选: {aqiRange[0]} - {aqiRange[1]}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="range"
            min={0}
            max={500}
            value={aqiRange[0]}
            onChange={(e) => onAqiRangeChange([Number(e.target.value), aqiRange[1]])}
            style={{ flex: 1 }}
          />
          <input
            type="range"
            min={0}
            max={500}
            value={aqiRange[1]}
            onChange={(e) => onAqiRangeChange([aqiRange[0], Number(e.target.value)])}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  )
}

interface LegendPanelProps {
  monthIndex: number
}

function LegendPanel({ monthIndex }: LegendPanelProps) {
  const stats = dataManager.getGlobalStats(monthIndex)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '120px',
        right: '20px',
        background: 'rgba(30,41,59,0.9)',
        borderRadius: '10px',
        padding: '12px',
        width: '160px',
        zIndex: 10,
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ color: '#E0E0E0', fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>AQI 图例</div>

      <div
        style={{
          height: '10px',
          borderRadius: '5px',
          background: 'linear-gradient(90deg, #00E676 0%, #FFEB3B 33%, #FF9800 66%, #FF1744 100%)',
          marginBottom: '4px',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#E0E0E0', opacity: 0.6 }}>
        <span>0</span>
        <span>500</span>
      </div>

      <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
        <div style={{ color: '#FFFFFF', fontSize: '16px', fontWeight: 'bold', marginBottom: '2px' }}>
          {stats.avgAqi}
          <span style={{ fontSize: '11px', opacity: 0.6, fontWeight: 'normal' }}> 全球平均</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00E676', flexShrink: 0 }} />
          <span style={{ color: '#E0E0E0', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stats.cleanest.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FF1744', flexShrink: 0 }} />
          <span style={{ color: '#E0E0E0', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stats.dirtiest.name}
          </span>
        </div>
      </div>
    </div>
  )
}

interface DetailsPanelProps {
  city: CityData | null
  onClose: () => void
}

function DetailsPanel({ city, onClose }: DetailsPanelProps) {
  if (!city) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1A1A2E',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '700px',
          width: '90%',
          border: '1px solid rgba(0,188,212,0.3)',
        }}
        className="animate-fade-in"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ color: '#FFFFFF', fontSize: '24px', margin: 0 }}>{city.name}</h2>
            <p style={{ color: '#00BCD4', fontSize: '13px', margin: '4px 0 0' }}>
              纬度: {city.lat.toFixed(4)}° | 经度: {city.lng.toFixed(4)}°
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              color: '#E0E0E0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <TrendChart cityId={city.id} monthIndex={0} width={600} height={200} />

        <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {['PM2.5', 'PM10', '温度', '风速'].map((label) => {
            const latest = city.monthlyData[city.monthlyData.length - 1]
            const values: Record<string, string> = {
              'PM2.5': `${latest?.pm25 ?? 0}`,
              'PM10': `${latest?.pm10 ?? 0}`,
              '温度': `${latest?.temperature ?? 0}°C`,
              '风速': `${latest?.windSpeed ?? 0} m/s`,
            }
            return (
              <div
                key={label}
                style={{
                  background: 'rgba(0,188,212,0.1)',
                  borderRadius: '8px',
                  padding: '12px',
                  textAlign: 'center',
                }}
              >
                <div style={{ color: '#FFD54F', fontSize: '20px', fontWeight: 'bold' }}>{values[label]}</div>
                <div style={{ color: '#E0E0E0', fontSize: '12px', opacity: 0.7 }}>{label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function UIPanel() {
  const [monthIndex, setMonthIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(1)
  const [selectedCity, setSelectedCity] = useState<CityData | null>(null)
  const [detailsCity, setDetailsCity] = useState<CityData | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('aqi')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bubble')
  const [aqiRange, setAqiRange] = useState<[number, number]>([0, 500])
  const [viewport, setViewport] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 1200 })
  const [showRotateHint, setShowRotateHint] = useState(true)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const layout = viewport.width < 768 ? 'side' : 'bottom'
  const controlLayout = viewport.width < 768 ? 'horizontal' : 'vertical'
  const hideTimeline = viewport.width < 480

  useEffect(() => {
    const handleResize = () => setViewport({ width: window.innerWidth })
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowRotateHint(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const unsub1 = eventBus.on('city:select', (city) => setSelectedCity(city))
    const unsub2 = eventBus.on('details:show', (city) => setDetailsCity(city))
    const unsub3 = eventBus.on('play:toggle', setIsPlaying)
    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  }, [])

  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setMonthIndex((prev) => {
          const next = (prev + 1) % TOTAL_MONTHS
          eventBus.emit('time:change', next)
          return next
        })
      }, 500 / playSpeed)
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current)
      playIntervalRef.current = null
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current)
    }
  }, [isPlaying, playSpeed])

  const handleMonthChange = useCallback((index: number) => {
    setMonthIndex(index)
    eventBus.emit('time:change', index)
  }, [])

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev)
  }, [])

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaySpeed(speed)
    eventBus.emit('speed:change', speed)
  }, [])

  const handleColorModeChange = useCallback((mode: ColorMode) => {
    setColorMode(mode)
    eventBus.emit('mode:color', mode)
  }, [])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    eventBus.emit('mode:display', mode)
  }, [])

  const handleAqiRangeChange = useCallback((range: [number, number]) => {
    setAqiRange(range)
    eventBus.emit('filter:aqi', range)
  }, [])

  const trendChartWidth = Math.min(600, viewport.width - 40)

  return (
    <>
      {showRotateHint && (
        <div className="rotate-hint" style={{ opacity: showRotateHint ? 1 : 0 }}>
          ↻ 拖拽旋转 · 滚轮缩放
        </div>
      )}

      <CityPopup
        city={selectedCity}
        monthIndex={monthIndex}
        onClose={() => eventBus.emit('city:select', null)}
      />

      <ControlPanel
        colorMode={colorMode}
        displayMode={displayMode}
        aqiRange={aqiRange}
        onColorModeChange={handleColorModeChange}
        onDisplayModeChange={handleDisplayModeChange}
        onAqiRangeChange={handleAqiRangeChange}
        layout={controlLayout}
      />

      <LegendPanel monthIndex={monthIndex} />

      {!hideTimeline && (
        <Timeline
          monthIndex={monthIndex}
          isPlaying={isPlaying}
          playSpeed={playSpeed}
          onTogglePlay={handleTogglePlay}
          onMonthChange={handleMonthChange}
          onSpeedChange={handleSpeedChange}
          layout={layout}
        />
      )}

      {viewport.width >= 480 && (
        <div
          style={{
            position: 'absolute',
            bottom: layout === 'bottom' ? '110px' : '20px',
            left: layout === 'bottom' ? '50%' : 'auto',
            right: layout === 'bottom' ? 'auto' : '20px',
            transform: layout === 'bottom' ? 'translateX(-50%)' : 'none',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 10,
          }}
        >
          <TrendChart
            cityId={selectedCity?.id ?? null}
            monthIndex={monthIndex}
            width={trendChartWidth}
            height={180}
          />
        </div>
      )}

      <DetailsPanel city={detailsCity} onClose={() => setDetailsCity(null)} />
    </>
  )
}
