import { useState, useEffect } from 'react'
import { EarthScene } from './EarthScene'
import { UIPanel } from './UIPanel'

function App() {
  const [earthRadius, setEarthRadius] = useState(5)

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth
      if (width < 768) {
        setEarthRadius(3)
      } else {
        setEarthRadius(5)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <EarthScene earthRadius={earthRadius} />
      </div>
      <UIPanel />
    </div>
  )
}

export default App
