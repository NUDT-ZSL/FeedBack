import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ClockworkWorkshop from './ClockworkWorkshop'
import { LanternType, LANTERN_CONFIGS, LanternInstance } from './types'
import { v4 as uuidv4 } from 'uuid'
import { Vector3 } from 'three'

function App() {
  const [selectedType, setSelectedType] = useState<LanternType>('blessing')
  const [showLanternPanel, setShowLanternPanel] = useState(false)
  const [targetHeight, setTargetHeight] = useState(5)
  const [lanterns, setLanterns] = useState<LanternInstance[]>([])
  const [selectedLanternId, setSelectedLanternId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<any>(null)

  const handleDragLantern = useCallback((type: LanternType, position: Vector3) => {
    if (lanterns.filter(l => l.state !== 'fallen').length >= 10) {
      return
    }
    const newLantern: LanternInstance = {
      id: uuidv4(),
      type,
      position: position.clone(),
      targetHeight: 5,
      currentHeight: position.y,
      state: 'hovering',
      igniteTime: null,
      fallTime: null,
      glowIntensity: 0.3,
      swayOffset: Math.random() * Math.PI * 2,
    }
    setLanterns(prev => [...prev, newLantern])
    setSelectedLanternId(newLantern.id)
    setShowLanternPanel(false)
  }, [lanterns])

  const handleIgnite = useCallback(() => {
    if (!selectedLanternId) return
    setLanterns(prev => prev.map(l => 
      l.id === selectedLanternId 
        ? { ...l, state: 'ignited' as const, igniteTime: performance.now(), targetHeight }
        : l
    ))
    setSelectedLanternId(null)
  }, [selectedLanternId, targetHeight])

  const handleScreenshot = useCallback(() => {
    if (!glRef.current) return
    
    const gl = glRef.current
    const renderer = gl.info.renderer
    
    const width = 1920
    const height = 1080
    
    const oldSize = { x: gl.domElement.width, y: gl.domElement.height }
    
    gl.setSize(width, height, false)
    gl.render(gl.scene, gl.camera)
    
    const dataURL = gl.domElement.toDataURL('image/png')
    
    gl.setSize(oldSize.x, oldSize.y, false)
    
    const link = document.createElement('a')
    link.download = `西湖灯会_${Date.now()}.png`
    link.href = dataURL
    link.click()
  }, [])

  const updateLanterns = useCallback((updated: LanternInstance[]) => {
    setLanterns(updated)
  }, [])

  const selectedLantern = lanterns.find(l => l.id === selectedLanternId)

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ClockworkWorkshop
        lanterns={lanterns}
        updateLanterns={updateLanterns}
        onCanvasReady={(gl, canvas) => {
          glRef.current = gl
        }}
        onLanternClick={(id) => {
          const lantern = lanterns.find(l => l.id === id)
          if (lantern && lantern.state === 'hovering') {
            setSelectedLanternId(id)
            setTargetHeight(lantern.targetHeight)
          }
        }}
        onDragLantern={handleDragLantern}
        selectedType={selectedType}
      />

      <AnimatePresence>
        {showLanternPanel && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(11, 12, 16, 0.95)',
              border: '2px solid #ffaa00',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 0 30px rgba(255, 170, 0, 0.3)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              zIndex: 100,
            }}
            className="lantern-panel"
          >
            <h2 style={{ color: '#ffd700', marginBottom: '16px', fontSize: '24px', textAlign: 'center' }}>
              灯库
            </h2>
            <div className="lantern-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
              {(Object.keys(LANTERN_CONFIGS) as LanternType[]).map(type => (
                <motion.div
                  key={type}
                  whileHover={{ scale: 1.1, boxShadow: '0 0 20px rgba(255, 170, 0, 0.5)' }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    width: '80px',
                    height: '100px',
                    background: 'rgba(0, 0, 0, 0.6)',
                    border: `2px solid ${selectedType === type ? '#ffd700' : '#444'}`,
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'grab',
                  }}
                >
                  <button
                    onClick={() => {
                      setSelectedType(type)
                      setShowLanternPanel(false)
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('lanternType', type)
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'grab',
                    }}
                  >
                  <div
                    style={{
                      width: '30px',
                      height: '40px',
                      background: LANTERN_CONFIGS[type].color,
                      borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                      boxShadow: `0 0 15px ${LANTERN_CONFIGS[type].color}`,
                      marginBottom: '8px',
                    }}
                  />
                    <span style={{ color: '#ffd700', fontSize: '14px' }}>
                      {LANTERN_CONFIGS[type].name}
                    </span>
                  </button>
                </motion.div>
              ))}
            </div>
            <button
              onClick={() => setShowLanternPanel(false)}
              style={{
                marginTop: '16px',
                width: '100%',
                padding: '8px',
                background: 'transparent',
                border: '1px solid #ffaa00',
                borderRadius: '4px',
                color: '#ffd700',
                fontSize: '14px',
              }}
            >
              关闭
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @media (max-width: 768px) {
          .control-panel {
            flex-direction: column !important;
            border-radius: 20px !important;
            padding: 16px !important;
            gap: 12px !important;
            width: 90% !important;
            max-width: 400px !important;
          }
          .control-panel .divider {
            width: 80% !important;
            height: 1px !important;
          }
          .control-panel .height-slider {
            width: 200px !important;
          }
          .lantern-panel {
            width: 90% !important;
            max-width: 400px !important;
          }
          .lantern-panel .lantern-grid {
            grid-template-columns: repeat(3, 1fr) !important;
          }
        }
      `}</style>
      <div
        className="control-panel"
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(11, 12, 16, 0.8)',
          backdropFilter: 'blur(15px)',
          WebkitBackdropFilter: 'blur(15px)',
          border: '2px solid #ffaa00',
          borderRadius: '50px',
          padding: '16px 32px',
          boxShadow: '0 0 30px rgba(255, 170, 0, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          zIndex: 50,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          {(Object.keys(LANTERN_CONFIGS) as LanternType[]).map(type => (
            <motion.button
              key={type}
              whileHover={{ scale: 1.1, boxShadow: '0 0 15px rgba(255, 170, 0, 0.5)' }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedType(type)}
              style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                background: selectedType === type 
                  ? LANTERN_CONFIGS[type].color 
                  : 'rgba(0,0,0,0.5)',
                border: `2px solid ${selectedType === type ? '#ffd700' : '#555'}`,
                boxShadow: selectedType === type 
                  ? `0 0 20px ${LANTERN_CONFIGS[type].color}` 
                  : 'none',
              }}
              title={LANTERN_CONFIGS[type].name}
            >
              <span style={{ color: '#ffd700', fontSize: '10px' }}>
                {LANTERN_CONFIGS[type].name[0]}
              </span>
            </motion.button>
          ))}
        </div>

        <div className="divider" style={{ width: '1px', height: '40px', background: '#ffaa00', opacity: 0.5 }} />

        <motion.button
          whileHover={{ scale: 1.1, boxShadow: '0 0 20px rgba(255, 170, 0, 0.5)' }}
          whileTap={{ scale: 0.95 }}
          onClick={handleIgnite}
          disabled={!selectedLantern}
          style={{
            padding: '12px 24px',
            background: selectedLantern 
              ? 'linear-gradient(135deg, #ff6600, #ff3300)' 
              : 'rgba(100, 100, 100, 0.5)',
            border: 'none',
            borderRadius: '25px',
            color: '#fff',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: selectedLantern ? 'pointer' : 'not-allowed',
            minWidth: '100px',
          }}
        >
          点火
        </motion.button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#ffd700', fontSize: '14px', whiteSpace: 'nowrap' }}>
            高度: {targetHeight}
          </span>
          <input
            type="range"
            min="0"
            max="10"
            value={targetHeight}
            onChange={(e) => setTargetHeight(Number(e.target.value))}
            className="height-slider"
            style={{
              width: '150px',
              accentColor: '#ffaa00',
              cursor: 'pointer',
            }}
          />
        </div>

        <div className="divider" style={{ width: '1px', height: '40px', background: '#ffaa00', opacity: 0.5 }} />

        <motion.button
          whileHover={{ scale: 1.1, boxShadow: '0 0 20px rgba(255, 170, 0, 0.5)' }}
          whileTap={{ scale: 0.95 }}
          onClick={handleScreenshot}
          style={{
            padding: '12px 24px',
            background: 'linear-gradient(135deg, #4488ff, #2255cc)',
            border: 'none',
            borderRadius: '25px',
            color: '#fff',
            fontSize: '16px',
            fontWeight: 'bold',
            minWidth: '100px',
          }}
        >
          截图
        </motion.button>
      </div>

      <motion.button
        whileHover={{ scale: 1.1, boxShadow: '0 0 20px rgba(255, 170, 0, 0.5)' }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setShowLanternPanel(true)}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'rgba(11, 12, 16, 0.9)',
          border: '2px solid #ffaa00',
          color: '#ffd700',
          fontSize: '24px',
          boxShadow: '0 0 20px rgba(255, 170, 0, 0.3)',
          zIndex: 50,
        }}
      >
        🏮
      </motion.button>

      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        color: '#ffd700',
        fontSize: '18px',
        textShadow: '0 0 10px rgba(255, 170, 0, 0.5)',
        zIndex: 50,
      }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>西湖灯会</div>
        <div style={{ fontSize: '14px', color: '#aaa' }}>
          拖动孔明灯至湖面 · 点击悬停的灯调整高度 · 点火升空
        </div>
      </div>
    </div>
  )
}

export default App
