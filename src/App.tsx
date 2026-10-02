import { useState } from 'react'
import BridgeScene from './components/BridgeScene'
import UIPanel from './components/UIPanel'

function App() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <BridgeScene />
      <UIPanel />
    </div>
  )
}

export default App
