import { useState, useEffect, useCallback, useRef } from 'react'
import Scene from './Scene'
import { MaterialPanel, ComponentPanel, StatusBar, LoadingSpinner } from './UI'
import { 
  WoodMaterial, 
  getMaterials, 
  selectMaterial, 
  getSelectedMaterial,
  clearSelection
} from './Materials'
import { 
  FurnitureComponent,
  AssemblyStep,
  getComponents,
  markAllProcessed,
  assembleComponent,
  checkSnapDistance,
  isAssemblyComplete,
  setCurrentStep,
  getCurrentStep,
  resetAssembly,
  setAutoRotate
} from './Assembly'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [materials, setMaterials] = useState<WoodMaterial[]>([])
  const [selectedMaterial, setSelectedMaterial] = useState<WoodMaterial | null>(null)
  const [selectedTool, setSelectedTool] = useState<'plane' | 'chisel' | null>(null)
  const [components, setComponents] = useState<FurnitureComponent[]>([])
  const [currentStep, setCurrentStepState] = useState<AssemblyStep>('select')
  const [hoveredComponent, setHoveredComponent] = useState<FurnitureComponent | null>(null)
  const [draggedComponent, setDraggedComponent] = useState<FurnitureComponent | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    setMaterials(getMaterials())
    setComponents(getComponents())
    
    const timer = setTimeout(() => {
      setLoading(false)
    }, 1500)
    
    return () => clearTimeout(timer)
  }, [])
  
  useEffect(() => {
    const interval = setInterval(() => {
      setComponents(getComponents())
      setCurrentStepState(getCurrentStep())
    }, 100)
    return () => clearInterval(interval)
  }, [])
  
  const handleMaterialSelect = useCallback((material: WoodMaterial) => {
    const selected = selectMaterial(material.id)
    if (selected) {
      setSelectedMaterial(selected)
      setMaterials(getMaterials())
      setCurrentStep('process')
      setCurrentStepState('process')
    }
  }, [])
  
  const handleProcessingComplete = useCallback(() => {
    markAllProcessed()
    setComponents(getComponents())
    setCurrentStep('assemble')
    setCurrentStepState('assemble')
    setSelectedTool(null)
  }, [])
  
  const handleToolSelect = useCallback((tool: 'plane' | 'chisel' | null) => {
    setSelectedTool(tool)
  }, [])
  
  const handleDragStart = useCallback((component: FurnitureComponent) => {
    setDraggedComponent(component)
  }, [])
  
  const handleDrop = useCallback((componentId: string, position: [number, number, number]): boolean => {
    const comp = components.find(c => c.id === componentId)
    if (!comp) return false
    
    if (checkSnapDistance(position, comp.targetPosition, 1.5)) {
      const success = assembleComponent(componentId)
      if (success) {
        setComponents(getComponents())
        playWoodSound()
        return true
      }
    }
    return false
  }, [components])
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])
  
  const handleDropOnViewport = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const componentId = e.dataTransfer.getData('componentId')
    if (!componentId || !draggedComponent || !viewportRef.current) return
    
    const rect = viewportRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 10 - 5
    const z = ((e.clientY - rect.top) / rect.height) * 8 - 4
    const position: [number, number, number] = [x, 1.2, z]
    
    handleDrop(componentId, position)
    setDraggedComponent(null)
  }, [draggedComponent, handleDrop])
  
  const playWoodSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      oscillator.frequency.setValueAtTime(150, audioContext.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(80, audioContext.currentTime + 0.15)
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15)
      
      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.15)
    } catch (e) {
      console.log('Audio not supported')
    }
  }
  
  const handleReset = useCallback(() => {
    resetAssembly()
    clearSelection()
    setSelectedMaterial(null)
    setSelectedTool(null)
    setMaterials(getMaterials())
    setComponents(getComponents())
    setCurrentStepState('select')
    setAutoRotate(false)
  }, [])
  
  const handleEnterDisplay = useCallback(() => {
    setCurrentStep('display')
    setCurrentStepState('display')
    setAutoRotate(true)
  }, [])
  
  const handleComponentHover = useCallback((component: FurnitureComponent | null) => {
    setHoveredComponent(component)
  }, [])
  
  const assemblyComplete = isAssemblyComplete()
  
  return (
    <div style={styles.appContainer}>
      <LoadingSpinner visible={loading} />
      
      <div style={styles.leftPanel}>
        <MaterialPanel
          materials={materials}
          selectedMaterial={selectedMaterial}
          onSelect={handleMaterialSelect}
        />
      </div>
      
      <div 
        ref={viewportRef}
        style={styles.viewport}
        onDragOver={handleDragOver}
        onDrop={handleDropOnViewport}
      >
        <Scene
          selectedMaterial={selectedMaterial}
          selectedTool={selectedTool}
          components={components}
          onProcessingComplete={handleProcessingComplete}
          onComponentHover={handleComponentHover}
        />
        
        {hoveredComponent && (
          <div style={styles.componentTooltip}>
            <div style={styles.tooltipTitle}>{hoveredComponent.name}</div>
            <div style={styles.tooltipDesc}>
              {hoveredComponent.type === 'seat' && '主体座面，采用榫卯结构连接各部件'}
              {hoveredComponent.type === 'armrest' && '扶手，提供倚靠支撑，线条圆润流畅'}
              {hoveredComponent.type === 'backrest' && '靠背，符合人体工学，带有云纹雕刻'}
              {hoveredComponent.type === 'footrest' && '踏脚，舒适放置双脚，可拆卸设计'}
            </div>
          </div>
        )}
        
        {draggedComponent && (
          <div style={styles.dragHint}>
            将「{draggedComponent.name}」拖拽到组装区域
          </div>
        )}
      </div>
      
      <div style={styles.rightPanel}>
        <ComponentPanel
          components={components}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        />
      </div>
      
      <StatusBar
        currentStep={currentStep}
        selectedTool={selectedTool}
        onToolSelect={handleToolSelect}
        onReset={handleReset}
        onEnterDisplay={handleEnterDisplay}
        assemblyComplete={assemblyComplete}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    position: 'relative' as const,
    overflow: 'hidden'
  },
  
  leftPanel: {
    width: '20%',
    height: 'calc(100% - 70px)',
    minWidth: '200px',
    position: 'relative' as const,
    zIndex: 10
  },
  
  viewport: {
    flex: 1,
    height: 'calc(100% - 70px)',
    position: 'relative' as const,
    backgroundColor: '#d2b48c'
  },
  
  rightPanel: {
    width: '20%',
    height: 'calc(100% - 70px)',
    minWidth: '200px',
    position: 'relative' as const,
    zIndex: 10
  },
  
  componentTooltip: {
    position: 'absolute' as const,
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(74, 28, 14, 0.95)',
    color: '#f5e6d0',
    padding: '15px 25px',
    borderRadius: '8px',
    zIndex: 100,
    textAlign: 'center' as const,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
    border: '1px solid #8b4513',
    maxWidth: '400px'
  },
  
  tooltipTitle: {
    fontSize: '20px',
    color: '#FFD700',
    marginBottom: '8px',
    letterSpacing: '2px'
  },
  
  tooltipDesc: {
    fontSize: '14px',
    lineHeight: '1.5'
  },
  
  dragHint: {
    position: 'absolute' as const,
    bottom: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(139, 69, 19, 0.95)',
    color: '#FFD700',
    padding: '12px 30px',
    borderRadius: '25px',
    fontSize: '16px',
    letterSpacing: '1px',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
    border: '2px solid #FFD700'
  }
}
