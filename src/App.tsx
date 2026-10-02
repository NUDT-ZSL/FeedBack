import { useState, useCallback } from 'react'
import WaterScene from './scene/WaterScene'
import ControlPanel from './components/ControlPanel'

function App() {
  const [poemTexts, setPoemTexts] = useState<{ id: number; x: number; y: number; z: number }[]>([])

  const handlePoemText = useCallback((x: number, y: number, z: number) => {
    const id = Date.now()
    setPoemTexts(prev => [...prev, { id, x, y, z }])

    setTimeout(() => {
      setPoemTexts(prev => prev.filter(text => text.id !== id))
    }, 2000)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <WaterScene poemTexts={poemTexts} onPoemText={handlePoemText} />
      <ControlPanel />

      <div
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          background: 'rgba(200, 180, 150, 0.2)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderRadius: '12px',
          border: '1px solid rgba(212, 167, 106, 0.3)',
          zIndex: 100,
          maxWidth: '300px'
        }}
      >
        <h3
          style={{
            color: '#d4a76a',
            fontSize: '16px',
            margin: '0 0 8px 0',
            fontFamily: 'Georgia, serif'
          }}
        >
          上巳节曲水流觞
        </h3>
        <p
          style={{
            color: '#6b7b6b',
            fontSize: '12px',
            lineHeight: '1.6',
            margin: 0,
            fontFamily: 'Georgia, serif'
          }}
        >
          汉代御花园中，铜雀吐水，羽觞随波。宾客围坐渠旁，静待酒杯漂至面前，赋诗饮酒，是为曲水流觞之雅事。
        </p>
      </div>
    </div>
  )
}

export default App
