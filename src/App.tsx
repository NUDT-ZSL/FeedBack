import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from './store'
import { Scene } from './scene'
import { generateScrollContent, saveScrollAsPng, ScrollData } from './scrollGenerator'

const Tooltip = ({ content, children }: { content: string; children: React.ReactNode }) => {
  const [show, setShow] = useState(false)
  
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: 8,
              padding: '6px 12px',
              background: '#ffffffcc',
              color: '#333333',
              borderRadius: 4,
              fontSize: 12,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 1000,
              backdropFilter: 'blur(4px)',
            }}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const KilnControlPanel = () => {
  const kilnTargetTemp = useStore(state => state.kilnTargetTemp)
  const setKilnTargetTemp = useStore(state => state.setKilnTargetTemp)
  const firingStage = useStore(state => state.firingStage)
  const startFiring = useStore(state => state.startFiring)
  const pot = useStore(state => state.pot)
  const clearTempHistory = useStore(state => state.clearTempHistory)
  const setKilnDoorOpen = useStore(state => state.setKilnDoorOpen)
  const resetPot = useStore(state => state.resetPot)
  
  const temperatures = []
  for (let t = 800; t <= 1300; t += 50) {
    temperatures.push(t)
  }
  
  const handleStart = () => {
    if (pot.hasGlaze && !pot.hasFired && firingStage === 'idle') {
      clearTempHistory()
      setKilnDoorOpen(false)
      setTimeout(() => startFiring(), 500)
    }
  }
  
  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOutCubic' }}
      style={{
        position: 'absolute',
        right: 20,
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'linear-gradient(135deg, #b8a88a 0%, #a8987a 100%)',
        padding: 20,
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        border: '2px solid #8b7355',
        minWidth: 220,
      }}
    >
      <h3 style={{
        margin: '0 0 15px 0',
        fontFamily: "'Ma Shan Zheng', cursive",
        color: '#5c3a21',
        fontSize: 20,
        textAlign: 'center',
      }}>
        柴窑温控
      </h3>
      
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 10px 0', fontSize: 14, color: '#3d2815' }}>
          目标温度: {kilnTargetTemp}°C
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
        }}>
          {temperatures.map(temp => (
            <Tooltip key={temp} content={`${temp}°C`}>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ duration: 0.1 }}
                onClick={() => firingStage === 'idle' && setKilnTargetTemp(temp)}
                disabled={firingStage !== 'idle'}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  borderRadius: 6,
                  border: kilnTargetTemp === temp ? '2px solid #8b0000' : '1px solid #6b5a45',
                  background: kilnTargetTemp === temp ? '#8b0000' : temp <= 1000 ? '#ff9933' : temp <= 1200 ? '#ff6600' : '#cc0000',
                  color: kilnTargetTemp === temp ? '#fff' : '#fff',
                  fontSize: 10,
                  fontWeight: 'bold',
                  cursor: firingStage !== 'idle' ? 'not-allowed' : 'pointer',
                  opacity: firingStage !== 'idle' ? 0.5 : 1,
                }}
              >
                {temp}
              </motion.button>
            </Tooltip>
          ))}
        </div>
      </div>
      
      <div style={{ marginBottom: 15, padding: 10, background: '#e8e0d0', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13, color: '#333' }}>
          当前温度: <span style={{ color: '#8b0000', fontWeight: 'bold', fontSize: 16 }}>
            {Math.round(pot.currentTemp)}°C
          </span>
        </p>
        <p style={{ margin: '5px 0 0 0', fontSize: 12, color: '#666' }}>
          状态: {
            firingStage === 'idle' ? '待烧制' :
            firingStage === 'heating' ? '升温中 🔥' :
            firingStage === 'cooling' ? '冷却中 ❄️' :
            '烧制完成 ✨'
          }
        </p>
      </div>
      
      <div style={{ display: 'flex', gap: 10 }}>
        <Tooltip content={!pot.hasGlaze ? '请先施釉' : firingStage !== 'idle' ? '烧制中' : '开始烧制'}>
          <motion.button
            whileHover={pot.hasGlaze && firingStage === 'idle' ? { scale: 1.05 } : {}}
            whileTap={pot.hasGlaze && firingStage === 'idle' ? { scale: 0.95 } : {}}
            transition={{ duration: 0.1 }}
            onClick={handleStart}
            disabled={!pot.hasGlaze || firingStage !== 'idle'}
            style={{
              flex: 1,
              padding: '12px 20px',
              background: (!pot.hasGlaze || firingStage !== 'idle') ? '#999' : '#8b0000',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 'bold',
              cursor: (!pot.hasGlaze || firingStage !== 'idle') ? 'not-allowed' : 'pointer',
              fontFamily: "'Noto Serif SC', serif",
            }}
          >
            🔥 点火
          </motion.button>
        </Tooltip>
      </div>
      
      {pot.hasFired && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.1 }}
          onClick={resetPot}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '8px',
            background: '#6b4c3b',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🔄 重新开始
        </motion.button>
      )}
    </motion.div>
  )
}

const GlazeInfoPanel = () => {
  const glazes = useStore(state => state.glazes)
  const selectedGlaze = useStore(state => state.selectedGlaze)
  const glazeThickness = useStore(state => state.glazeThickness)
  const isDraggingGlaze = useStore(state => state.isDraggingGlaze)
  const glazeStrokes = useStore(state => state.glazeStrokes)
  
  const currentGlaze = glazes.find(g => g.id === selectedGlaze)
  
  return (
    <motion.div
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOutCubic' }}
      style={{
        position: 'absolute',
        left: 20,
        top: 20,
        background: 'linear-gradient(135deg, #8b7355 0%, #7a6345 100%)',
        padding: 15,
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        border: '2px solid #6b5a45',
        minWidth: 200,
        color: '#fff',
      }}
    >
      <h3 style={{
        margin: '0 0 12px 0',
        fontFamily: "'Ma Shan Zheng', cursive",
        fontSize: 18,
        textAlign: 'center',
      }}>
        釉料架
      </h3>
      
      {currentGlaze ? (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
            padding: 10,
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 8,
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: currentGlaze.color,
              border: '2px solid #fff',
            }} />
            <div>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: 15 }}>{currentGlaze.name}</p>
            </div>
          </div>
          
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ margin: '5px 0' }}>
              黏稠度: <span style={{ color: '#ffdd88' }}>{(currentGlaze.viscosity * 100).toFixed(0)}%</span>
            </p>
            <p style={{ margin: '5px 0' }}>
              烧成温度: <span style={{ color: '#ff8888' }}>{currentGlaze.tempRange[0]}-{currentGlaze.tempRange[1]}°C</span>
            </p>
          </div>
          
          <div style={{ marginTop: 15, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.3)' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>
              釉层厚度: <span style={{ color: '#88ff88', fontWeight: 'bold' }}>{glazeThickness.toFixed(2)}</span>
            </p>
            <div style={{
              width: '100%',
              height: 6,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 3,
              overflow: 'hidden',
            }}>
              <motion.div
                animate={{ width: `${((glazeThickness - 0.1) / 0.4) * 100}%` }}
                transition={{ duration: 0.3, ease: 'easeInOutCubic' }}
                style={{
                  height: '100%',
                  background: `linear-gradient(90deg, ${currentGlaze.color}, #fff)`,
                }}
              />
            </div>
            <p style={{ margin: '8px 0 0 0', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              滚动滚轮调节厚度 (0.1-0.5)
            </p>
          </div>
          
          {isDraggingGlaze && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              style={{
                marginTop: 12,
                padding: 8,
                background: '#8b0000',
                borderRadius: 6,
                textAlign: 'center',
                fontSize: 13,
              }}
            >
              正在施釉... 拖动鼠标在瓶胚上涂抹
            </motion.div>
          )}
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, textAlign: 'center', opacity: 0.8 }}>
          点击左侧陶罐选择釉料
        </p>
      )}
      
      {glazeStrokes.length > 0 && (
        <div style={{
          marginTop: 12,
          padding: 8,
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 6,
          fontSize: 12,
          textAlign: 'center',
        }}>
          已涂抹 {glazeStrokes.length} 笔
        </div>
      )}
    </motion.div>
  )
}

const ActionButtons = () => {
  const pot = useStore(state => state.pot)
  const useTongs = useStore(state => state.useTongs)
  const setUseTongs = useStore(state => state.setUseTongs)
  const showScroll = useStore(state => state.showScroll)
  const setShowScroll = useStore(state => state.setShowScroll)
  
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOutCubic', delay: 0.2 }}
      style={{
        position: 'absolute',
        bottom: 30,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 15,
      }}
    >
      <Tooltip content={pot.position === 'table' ? '将瓶胚送入窑内' : pot.position === 'kiln' ? '瓶胚已在窑内' : '瓷器已取出'}>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.1 }}
          onClick={() => {
            if (pot.position === 'table' && pot.hasGlaze && !pot.hasFired) {
              useStore.getState().setPotPosition('kiln')
              useStore.getState().setKilnDoorOpen(true)
            }
          }}
          disabled={pot.position !== 'table' || !pot.hasGlaze || pot.hasFired}
          style={{
            padding: '12px 24px',
            background: pot.position !== 'table' || !pot.hasGlaze || pot.hasFired ? '#999' : '#5d8a6b',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 'bold',
            cursor: pot.position !== 'table' || !pot.hasGlaze || pot.hasFired ? 'not-allowed' : 'pointer',
            fontFamily: "'Noto Serif SC', serif",
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          🏺 送入窑内
        </motion.button>
      </Tooltip>
      
      <Tooltip content={!pot.hasFired ? '请等待烧制完成' : useTongs ? '取消夹钳' : '使用夹钳取出瓷器'}>
        <motion.button
          whileHover={pot.hasFired ? { scale: 1.05 } : {}}
          whileTap={pot.hasFired ? { scale: 0.95 } : {}}
          transition={{ duration: 0.1 }}
          onClick={() => pot.hasFired && setUseTongs(!useTongs)}
          disabled={!pot.hasFired}
          style={{
            padding: '12px 24px',
            background: !pot.hasFired ? '#999' : useTongs ? '#b56e7d' : '#8b7355',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 'bold',
            cursor: !pot.hasFired ? 'not-allowed' : 'pointer',
            fontFamily: "'Noto Serif SC', serif",
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          🔧 {useTongs ? '取消夹钳' : '使用夹钳'}
        </motion.button>
      </Tooltip>
      
      <Tooltip content={!pot.hasFired ? '请等待烧制完成' : '查看并保存窑宝录'}>
        <motion.button
          whileHover={pot.hasFired ? { scale: 1.05 } : {}}
          whileTap={pot.hasFired ? { scale: 0.95 } : {}}
          transition={{ duration: 0.1 }}
          onClick={() => pot.hasFired && setShowScroll(true)}
          disabled={!pot.hasFired}
          style={{
            padding: '12px 24px',
            background: !pot.hasFired ? '#999' : '#8b0000',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 'bold',
            cursor: !pot.hasFired ? 'not-allowed' : 'pointer',
            fontFamily: "'Noto Serif SC', serif",
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          📜 记录卷轴
        </motion.button>
      </Tooltip>
    </motion.div>
  )
}

const ScrollModal = () => {
  const showScroll = useStore(state => state.showScroll)
  const setShowScroll = useStore(state => state.setShowScroll)
  const scrollGenerating = useStore(state => state.scrollGenerating)
  const setScrollGenerating = useStore(state => state.setScrollGenerating)
  const pot = useStore(state => state.pot)
  const glazeStrokes = useStore(state => state.glazeStrokes)
  const glazes = useStore(state => state.glazes)
  const tempHistory = useStore(state => state.tempHistory)
  const kilnTargetTemp = useStore(state => state.kilnTargetTemp)
  
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  
  useEffect(() => {
    if (showScroll && !scrollElement) {
      setScrollGenerating(true)
      
      setTimeout(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 300
        canvas.height = 300
        const ctx = canvas.getContext('2d')!
        
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, 300, 300)
        
        const usedGlazes = [...new Set(glazeStrokes.map(s => s.glazeId))]
        if (usedGlazes.length > 0) {
          const mainGlaze = glazes.find(g => g.id === usedGlazes[0])
          if (mainGlaze) {
            ctx.fillStyle = mainGlaze.color
            ctx.beginPath()
            ctx.ellipse(150, 150, 80, 120, 0, 0, Math.PI * 2)
            ctx.fill()
            
            pot.textureData.spots.forEach(spot => {
              const x = 150 + (spot.x - 0.5) * 140
              const y = 150 + (spot.y - 0.5) * 200
              const radius = spot.size * 250
              
              ctx.fillStyle = spot.color + 'aa'
              ctx.beginPath()
              ctx.arc(x, y, radius, 0, Math.PI * 2)
              ctx.fill()
            })
          }
        } else {
          ctx.fillStyle = '#e8e0d0'
          ctx.beginPath()
          ctx.ellipse(150, 150, 80, 120, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        
        const potImageData = canvas.toDataURL('image/png')
        
        const glazesUsed = usedGlazes.map(id => {
          const glaze = glazes.find(g => g.id === id)!
          const strokes = glazeStrokes.filter(s => s.glazeId === id)
          const avgThickness = strokes.reduce((sum, s) => sum + s.thickness, 0) / strokes.length
          return {
            glaze,
            thickness: avgThickness,
            area: strokes.length,
          }
        })
        
        const scrollData: ScrollData = {
          potImageData,
          glazesUsed,
          tempHistory,
          textureData: pot.textureData,
          targetTemp: kilnTargetTemp,
        }
        
        const scroll = generateScrollContent(scrollData)
        setScrollElement(scroll)
        setScrollGenerating(false)
      }, 500)
    }
    
    if (!showScroll) {
      setScrollElement(null)
    }
  }, [showScroll, pot, glazeStrokes, glazes, tempHistory, kilnTargetTemp, scrollElement, setScrollGenerating])
  
  useEffect(() => {
    if (scrollContainerRef.current && scrollElement) {
      scrollContainerRef.current.innerHTML = ''
      scrollContainerRef.current.appendChild(scrollElement)
    }
  }, [scrollElement])
  
  const handleSave = async () => {
    if (scrollElement) {
      setScrollGenerating(true)
      try {
        await saveScrollAsPng(scrollElement)
      } catch (e) {
        console.error('Save failed:', e)
      }
      setScrollGenerating(false)
    }
  }
  
  return (
    <AnimatePresence>
      {showScroll && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowScroll(false)}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeInOutCubic' }}
            style={{
              position: 'relative',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 20,
            }}
          >
            {scrollGenerating && !scrollElement && (
              <div style={{
                width: 300,
                height: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f5f0e8',
                borderRadius: 8,
                color: '#666',
                fontFamily: "'Noto Serif SC', serif",
              }}>
                卷轴生成中...
              </div>
            )}
            
            <div ref={scrollContainerRef} />
            
            <div style={{
              display: 'flex',
              gap: 10,
              marginTop: 15,
              justifyContent: 'center',
            }}>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSave}
                disabled={scrollGenerating || !scrollElement}
                style={{
                  padding: '10px 30px',
                  background: scrollGenerating || !scrollElement ? '#999' : '#8b0000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 'bold',
                  cursor: scrollGenerating || !scrollElement ? 'not-allowed' : 'pointer',
                  fontFamily: "'Noto Serif SC', serif",
                }}
              >
                💾 保存PNG
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowScroll(false)}
                style={{
                  padding: '10px 30px',
                  background: '#666',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontFamily: "'Noto Serif SC', serif",
                }}
              >
                关闭
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const DragCursor = () => {
  const isDraggingGlaze = useStore(state => state.isDraggingGlaze)
  const dragPosition = useStore(state => state.dragPosition)
  const selectedGlaze = useStore(state => state.selectedGlaze)
  const glazes = useStore(state => state.glazes)
  const glazeThickness = useStore(state => state.glazeThickness)
  
  const currentGlaze = glazes.find(g => g.id === selectedGlaze)
  
  if (!isDraggingGlaze || !dragPosition || !currentGlaze) return null
  
  return (
    <div
      style={{
        position: 'fixed',
        left: dragPosition.x,
        top: dragPosition.y,
        width: 20 + glazeThickness * 30,
        height: 20 + glazeThickness * 30,
        borderRadius: '50%',
        background: currentGlaze.color,
        opacity: 0.6,
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        boxShadow: `0 0 ${10 + glazeThickness * 20}px ${currentGlaze.color}`,
        zIndex: 3000,
        mixBlendMode: 'multiply',
      }}
    />
  )
}

const TongsCursor = () => {
  const useTongs = useStore(state => state.useTongs)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  
  useEffect(() => {
    const handleMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY })
    if (useTongs) {
      window.addEventListener('mousemove', handleMove)
    }
    return () => window.removeEventListener('mousemove', handleMove)
  }, [useTongs])
  
  if (!useTongs) return null
  
  return (
    <div
      style={{
        position: 'fixed',
        left: mousePos.x,
        top: mousePos.y,
        fontSize: 32,
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        zIndex: 3000,
      }}
    >
      🔧
    </div>
  )
}

const TitleBar = () => {
  return (
    <motion.div
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeInOutCubic' }}
      style={{
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        zIndex: 10,
      }}
    >
      <h1 style={{
        margin: 0,
        fontFamily: "'Ma Shan Zheng', cursive",
        fontSize: 36,
        color: '#5c3a21',
        textShadow: '2px 2px 4px rgba(0,0,0,0.1)',
        letterSpacing: '4px',
      }}>
        宋代瓷窑工坊
      </h1>
      <p style={{
        margin: '5px 0 0 0',
        fontSize: 14,
        color: '#8b7355',
        fontFamily: "'Noto Serif SC', serif",
      }}>
        施釉 · 窑变 · 传世
      </p>
    </motion.div>
  )
}

const HelpTip = () => {
  const [show, setShow] = useState(true)
  
  if (!show) return null
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{
        position: 'absolute',
        top: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#ffffffee',
        padding: '15px 25px',
        borderRadius: 8,
        boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
        maxWidth: 500,
        zIndex: 100,
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        onClick={() => setShow(false)}
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          background: 'none',
          border: 'none',
          fontSize: 18,
          cursor: 'pointer',
          color: '#999',
        }}
      >
        ×
      </button>
      <h4 style={{ margin: '0 0 10px 0', color: '#5c3a21', fontFamily: "'Ma Shan Zheng', cursive", fontSize: 18 }}>
        使用指南
      </h4>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.8 }}>
        <li>🖱️ <strong>左键拖拽</strong>：旋转视角</li>
        <li>🔍 <strong>滚轮</strong>：缩放视角 / 施釉时调节厚度</li>
        <li>➡️ <strong>右键拖拽</strong>：平移画面</li>
        <li>🏺 <strong>点击釉料罐</strong>：选择釉料并开始施釉</li>
        <li>🎨 <strong>拖拽涂抹</strong>：在瓶胚上绘制釉层</li>
        <li>🔥 <strong>调节温度</strong>：点击刻度盘设置烧成温度</li>
      </ul>
    </motion.div>
  )
}

const App = () => {
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkWidth = () => setIsMobile(window.innerWidth < 768)
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])
  
  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      background: '#f5f0e8',
      cursor: useStore.getState().useTongs ? 'none' : 'default',
    }}>
      <style>{`
        @keyframes rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @media (max-width: 768px) {
          .control-panel {
            top: auto !important;
            bottom: 100px !important;
            transform: none !important;
            min-width: auto !important;
            width: calc(100% - 40px) !important;
          }
          
          .glaze-panel {
            top: 80px !important;
            left: 10px !important;
            min-width: auto !important;
            width: calc(50% - 20px) !important;
          }
        }
      `}</style>
      
      <Scene />
      
      <TitleBar />
      <HelpTip />
      
      <div className="glaze-panel">
        <GlazeInfoPanel />
      </div>
      
      {!isMobile && (
        <div className="control-panel">
          <KilnControlPanel />
        </div>
      )}
      
      {isMobile && (
        <div className="control-panel" style={{
          position: 'absolute',
          right: 10,
          top: 80,
          minWidth: 'auto',
          width: 'calc(50% - 20px)',
          transform: 'none',
        }}>
          <KilnControlPanel />
        </div>
      )}
      
      <ActionButtons />
      <ScrollModal />
      <DragCursor />
      <TongsCursor />
    </div>
  )
}

export default App