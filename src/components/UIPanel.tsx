import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styled from '@emotion/styled'
import { useGameStore } from '../store/gameStore'

const PanelContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 100;
  font-family: 'Noto Serif SC', 'ZCOOL XiaoWei', serif;
`

const ControlPanel = styled.div`
  position: absolute;
  bottom: 20px;
  left: 20px;
  background: linear-gradient(135deg, #deb887 0%, #d2b48c 50%, #c4a574 100%);
  border: 3px solid #8b3a3a;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 
    0 4px 20px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  min-width: 280px;

  &::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 30px;
    height: 16px;
    background: #8b3a3a;
    border-radius: 4px 4px 0 0;
  }
`

const ControlTitle = styled.h3`
  color: #5c4033;
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 15px 0;
  text-align: center;
  letter-spacing: 2px;
  border-bottom: 2px solid #8b3a3a;
  padding-bottom: 8px;
`

const ControlRow = styled.div`
  margin-bottom: 18px;

  &:last-child {
    margin-bottom: 0;
  }
`

const ControlLabel = styled.label`
  display: block;
  color: #5c4033;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const ValueDisplay = styled.span<{ value: number; max: number }>`
  font-size: 13px;
  font-weight: 700;
  background: linear-gradient(90deg, 
    ${props => {
      const ratio = props.value / props.max
      if (ratio < 0.3) return '#228b22'
      if (ratio < 0.7) return '#ffd700'
      return '#dc143c'
    }}
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  transition: all 0.3s ease;
`

const SliderContainer = styled.div`
  position: relative;
  height: 24px;
  background: #8b7355;
  border-radius: 12px;
  padding: 4px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
`

const Slider = styled.input<{ value: number; max: number }>`
  width: 100%;
  height: 16px;
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;

  &::-webkit-slider-runnable-track {
    height: 16px;
    border-radius: 8px;
    background: linear-gradient(90deg, 
      #90ee90 0%, 
      #90ee90 ${props => (props.value / props.max) * 100}%, 
      #5c4033 ${props => (props.value / props.max) * 100}%, 
      #5c4033 100%
    );
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #8b3a3a 0%, #654321 100%);
    border: 2px solid #ffd700;
    cursor: pointer;
    margin-top: -2px;
    box-shadow: 
      0 2px 6px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.3);
    transition: transform 0.2s ease;

    &:hover {
      transform: scale(1.15);
    }

    &:active {
      transform: scale(0.95);
    }
  }

  &::-moz-range-track {
    height: 16px;
    border-radius: 8px;
    background: linear-gradient(90deg, 
      #90ee90 0%, 
      #90ee90 ${props => (props.value / props.max) * 100}%, 
      #5c4033 ${props => (props.value / props.max) * 100}%, 
      #5c4033 100%
    );
  }

  &::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #8b3a3a 0%, #654321 100%);
    border: 2px solid #ffd700;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }
`

const KnobContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
`

const Knob = styled.div<{ rotation: number }>`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #deb887 0%, #8b7355 100%);
  border: 3px solid #8b3a3a;
  position: relative;
  cursor: grab;
  box-shadow: 
    0 4px 10px rgba(0, 0, 0, 0.3),
    inset 0 2px 4px rgba(255, 255, 255, 0.3);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 
      0 6px 15px rgba(0, 0, 0, 0.4),
      inset 0 2px 4px rgba(255, 255, 255, 0.3);
  }

  &::after {
    content: '';
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%) rotate(${props => props.rotation}deg);
    transform-origin: center 22px;
    width: 4px;
    height: 22px;
    background: #8b3a3a;
    border-radius: 2px;
  }

  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: radial-gradient(circle, #ffd700 0%, #8b3a3a 100%);
    border: 1px solid #5c4033;
  }
`

const WindScale = styled.div`
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 10px;
  color: #5c4033;
  margin-top: 5px;
`

const InfoPanel = styled(motion.div)`
  position: absolute;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
  width: 320px;
  background: linear-gradient(135deg, #deb887 0%, #d2b48c 50%, #c4a574 100%);
  border: 4px solid #8b3a3a;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 
    0 8px 30px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.3),
    inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  pointer-events: auto;

  &::before, &::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    background: #8b3a3a;
    border-radius: 50%;
  }

  &::before {
    top: 10px;
    left: 10px;
  }

  &::after {
    top: 10px;
    right: 10px;
  }
`

const InfoTitle = styled.h2`
  color: #8b3a3a;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 15px 0;
  text-align: center;
  letter-spacing: 3px;
  padding-bottom: 10px;
  border-bottom: 3px double #8b3a3a;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.1);
`

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px dashed rgba(139, 58, 58, 0.3);

  &:last-child {
    border-bottom: none;
  }
`

const InfoLabel = styled.span`
  color: #5c4033;
  font-size: 14px;
  font-weight: 600;
`

const InfoValue = styled.span`
  color: #2f4f4f;
  font-size: 15px;
  font-weight: 700;
  font-family: 'ZCOOL XiaoWei', serif;
`

const StatusBadge = styled.span<{ status: 'normal' | 'warning' | 'danger' }>`
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 700;
  color: white;
  background: ${props => {
    switch (props.status) {
      case 'normal': return 'linear-gradient(135deg, #228b22, #32cd32)'
      case 'warning': return 'linear-gradient(135deg, #ffa500, #ff8c00)'
      case 'danger': return 'linear-gradient(135deg, #dc143c, #ff0000)'
      default: return '#666'
    }
  }};
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  animation: ${props => props.status === 'danger' ? 'pulse 1s infinite' : 'none'};

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
`

const CloseButton = styled.button`
  position: absolute;
  top: 8px;
  right: 30px;
  background: #8b3a3a;
  color: #ffd700;
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #a0522d;
    transform: scale(1.1);
  }
`

const ShipIcon = styled.div<{ color: string }>`
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: ${props => props.color};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  border: 2px solid #5c4033;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
`

const HeaderSection = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 15px;
`

const HeaderInfo = styled.div`
  flex: 1;
`

const ShipName = styled.h3`
  color: #8b3a3a;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 2px;
`

const ShipType = styled.p`
  color: #5c4033;
  font-size: 12px;
  margin: 2px 0 0 0;
  opacity: 0.8;
`

const AlertOverlay = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 6px solid #ff0000;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 200;
`

const TitleBanner = styled.div`
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #8b3a3a 0%, #654321 100%);
  border: 3px solid #ffd700;
  border-radius: 8px;
  padding: 10px 30px;
  color: #ffd700;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 8px;
  font-family: 'ZCOOL XiaoWei', serif;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
`

const shipTypeNames: Record<string, string> = {
  cargo: '漕运货船',
  passenger: '客运班船',
  fishing: '渔业作业船',
  pleasure: '游乐画舫'
}

const shipEmojis: Record<string, string> = {
  cargo: '🚢',
  passenger: '⛴️',
  fishing: '🚤',
  pleasure: '🛥️'
}

function UIPanel() {
  const { waterLevel, windSpeed, selectedShipId, ships, setWaterLevel, setWindSpeed, setSelectedShipId, alertActive } = useGameStore()
  const [knobAngle, setKnobAngle] = useState((windSpeed / 8) * 270 - 135)
  const [isDragging, setIsDragging] = useState(false)
  const knobRef = useRef<HTMLDivElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastAlertState = useRef(false)

  const selectedShip = ships.find(s => s.id === selectedShipId)

  useEffect(() => {
    setKnobAngle((windSpeed / 8) * 270 - 135)
  }, [windSpeed])

  useEffect(() => {
    if (alertActive && !lastAlertState.current) {
      playAlertSound()
    }
    lastAlertState.current = alertActive
  }, [alertActive])

  const playAlertSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioContextRef.current
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(800, ctx.currentTime)
      oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1)
      oscillator.frequency.setValueAtTime(800, ctx.currentTime + 0.2)

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.4)
    } catch (e) {
      console.log('Audio not available')
    }
  }, [])

  const handleKnobMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !knobRef.current) return
      
      const rect = knobRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI) + 90
      const normalizedAngle = Math.max(-135, Math.min(135, angle))
      
      const newWindSpeed = Math.round(((normalizedAngle + 135) / 270) * 8)
      setWindSpeed(newWindSpeed)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setWindSpeed])

  const handleClosePanel = useCallback(() => {
    setSelectedShipId(null)
  }, [setSelectedShipId])

  return (
    <PanelContainer>
      <TitleBanner>汴京虹桥巡检</TitleBanner>

      <AnimatePresence>
        {alertActive && (
          <AlertOverlay
            initial={{ opacity: 0 }}
            animate={{ opacity: [1, 0.3, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
          />
        )}
      </AnimatePresence>

      <ControlPanel>
        <ControlTitle>河道巡检司</ControlTitle>

        <ControlRow>
          <ControlLabel>
            <span>🌊 水位高度</span>
            <ValueDisplay value={waterLevel} max={10}>
              {waterLevel.toFixed(1)} 丈
            </ValueDisplay>
          </ControlLabel>
          <SliderContainer>
            <Slider
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={waterLevel}
              onChange={(e) => setWaterLevel(parseFloat(e.target.value))}
            />
          </SliderContainer>
        </ControlRow>

        <ControlRow>
          <ControlLabel>
            <span>💨 风速等级</span>
            <ValueDisplay value={windSpeed} max={8}>
              {windSpeed} 级
            </ValueDisplay>
          </ControlLabel>
          <KnobContainer>
            <Knob
              ref={knobRef}
              rotation={knobAngle}
              onMouseDown={handleKnobMouseDown}
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            />
            <WindScale>
              <span>0</span>
              <span>2</span>
              <span>4</span>
              <span>6</span>
              <span>8</span>
            </WindScale>
          </KnobContainer>
        </ControlRow>
      </ControlPanel>

      <AnimatePresence>
        {selectedShip && (
          <InfoPanel
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300, duration: 0.4 }}
          >
            <CloseButton onClick={handleClosePanel}>×</CloseButton>
            <InfoTitle>船舶档案</InfoTitle>

            <HeaderSection>
              <ShipIcon color={selectedShip.color}>
                {shipEmojis[selectedShip.type]}
              </ShipIcon>
              <HeaderInfo>
                <ShipName>{selectedShip.name}</ShipName>
                <ShipType>{shipTypeNames[selectedShip.type]}</ShipType>
              </HeaderInfo>
            </HeaderSection>

            <InfoRow>
              <InfoLabel>📦 载货名称</InfoLabel>
              <InfoValue>{selectedShip.cargo}</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>⚖️ 载货重量</InfoLabel>
              <InfoValue>{selectedShip.cargoWeight} 石</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>🌊 吃水深度</InfoLabel>
              <InfoValue>{selectedShip.draft.toFixed(1)} 尺</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>⚓ 当前航速</InfoLabel>
              <InfoValue>{selectedShip.speed.toFixed(1)} 节</InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>🚦 通航状态</InfoLabel>
              <StatusBadge status={selectedShip.navigationStatus}>
                {selectedShip.navigationStatus === 'normal' ? '正常通行' : 
                 selectedShip.navigationStatus === 'warning' ? '谨慎通过' : '危险停航'}
              </StatusBadge>
            </InfoRow>
          </InfoPanel>
        )}
      </AnimatePresence>
    </PanelContainer>
  )
}

export default UIPanel
