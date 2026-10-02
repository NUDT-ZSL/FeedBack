import SundialScene from './scene/SundialScene'
import ControlPanel from './components/ControlPanel'

export default function App() {
  return (
    <div className="app-container">
      <div className="canvas-container">
        <SundialScene />
      </div>
      <ControlPanel />
    </div>
  )
}
