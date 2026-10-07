import { useState, useRef, useEffect } from 'react'
import { gsap } from 'gsap'
import { WoodMaterial } from './Materials'
import { FurnitureComponent, ComponentType, checkSnapDistance, assembleComponent } from './Assembly'

interface MaterialPanelProps {
  materials: WoodMaterial[]
  selectedMaterial: WoodMaterial | null
  onSelect: (material: WoodMaterial) => void
}

interface ComponentPanelProps {
  components: FurnitureComponent[]
  onDragStart: (component: FurnitureComponent) => void
  onDrop: (componentId: string, position: [number, number, number]) => boolean
}

interface StatusBarProps {
  currentStep: string
  selectedTool: 'plane' | 'chisel' | null
  onToolSelect: (tool: 'plane' | 'chisel' | null) => void
  onReset: () => void
  onEnterDisplay: () => void
  assemblyComplete: boolean
}

interface LoadingSpinnerProps {
  visible: boolean
}

export function MaterialPanel({ materials, selectedMaterial, onSelect }: MaterialPanelProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  
  return (
    <div style={styles.materialPanel}>
      <h3 style={styles.panelTitle}>木料架</h3>
      <div style={styles.materialGrid}>
        {materials.map(material => (
          <div
            key={material.id}
            style={{
              ...styles.materialItem,
              backgroundColor: material.color,
              transform: hoveredId === material.id ? 'scale(1.2)' : 'scale(1)',
              boxShadow: selectedMaterial?.id === material.id 
                ? '0 0 20px rgba(255, 215, 0, 0.8)' 
                : hoveredId === material.id
                  ? '0 8px 25px rgba(0, 0, 0, 0.4)'
                  : '0 4px 15px rgba(0, 0, 0, 0.3)',
              border: selectedMaterial?.id === material.id 
                ? '3px solid #FFD700' 
                : '2px solid rgba(0, 0, 0, 0.2)'
            }}
            onMouseEnter={() => setHoveredId(material.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onSelect(material)}
          >
            <WoodTexturePreview texture={material.texture} color={material.color} />
            
            {hoveredId === material.id && (
              <div style={styles.materialTooltip}>
                <div style={styles.tooltipName}>{material.name}</div>
                <div style={styles.tooltipRow}>
                  <span>重量:</span>
                  <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${material.weight}%` }} />
                  </div>
                  <span>{material.weight}</span>
                </div>
                <div style={styles.tooltipRow}>
                  <span>硬度:</span>
                  <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${material.hardness}%` }} />
                  </div>
                  <span>{material.hardness}</span>
                </div>
                <div style={styles.tooltipRow}>
                  <span>韧性:</span>
                  <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${material.toughness}%` }} />
                  </div>
                  <span>{material.toughness}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function WoodTexturePreview({ texture, color }: { texture: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const baseColor = new (window as any).THREE?.Color(color) || { r: 0.3, g: 0.1, b: 0.05 }
    
    ctx.fillStyle = `rgb(${baseColor.r * 255}, ${baseColor.g * 255}, ${baseColor.b * 255})`
    ctx.fillRect(0, 0, 80, 80)
    
    for (let i = 0; i < 80; i += 3) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      
      if (texture === 'straight') {
        ctx.moveTo(0, i)
        ctx.lineTo(80, i)
      } else if (texture === 'wave') {
        ctx.moveTo(0, i)
        for (let x = 0; x < 80; x += 5) {
          ctx.lineTo(x, i + Math.sin(x * 0.1 + i * 0.05) * 3)
        }
      } else if (texture === 'oxhair') {
        ctx.moveTo(0, i)
        ctx.bezierCurveTo(27, i + 3, 54, i - 3, 80, i + (Math.random() - 0.5) * 4)
      } else if (texture === 'gold') {
        ctx.moveTo(0, i)
        ctx.lineTo(80, i)
        if (Math.random() > 0.8) {
          ctx.fillStyle = '#FFD700'
          for (let j = 0; j < 2; j++) {
            ctx.beginPath()
            ctx.arc(Math.random() * 80, i + (Math.random() - 0.5) * 5, 1, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.stroke()
    }
  }, [texture, color])
  
  return <canvas ref={canvasRef} width={80} height={80} style={styles.textureCanvas} />
}

export function ComponentPanel({ components, onDragStart, onDrop }: ComponentPanelProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  
  const handleDragStart = (e: React.DragEvent, component: FurnitureComponent) => {
    if (!component.processed) {
      e.preventDefault()
      return
    }
    setDraggedId(component.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('componentId', component.id)
    onDragStart(component)
  }
  
  const handleDragEnd = () => {
    setDraggedId(null)
  }
  
  const getComponentIcon = (type: ComponentType) => {
    switch (type) {
      case 'seat': return '座'
      case 'armrest': return '扶'
      case 'backrest': return '靠'
      case 'footrest': return '踏'
    }
  }
  
  return (
    <div style={styles.componentPanel}>
      <h3 style={styles.panelTitle}>构件库</h3>
      <div style={styles.componentList}>
        {components.map(component => (
          <div
            key={component.id}
            draggable={component.processed && !component.assembled}
            onDragStart={(e) => handleDragStart(e, component)}
            onDragEnd={handleDragEnd}
            style={{
              ...styles.componentCard,
              opacity: component.assembled ? 0.3 : component.processed ? 1 : 0.4,
              cursor: component.processed && !component.assembled ? 'grab' : 'not-allowed',
              transform: draggedId === component.id ? 'scale(0.95)' : 'scale(1)',
              boxShadow: component.assembled 
                ? 'inset 0 0 10px rgba(0, 255, 0, 0.3)' 
                : component.processed 
                  ? '0 4px 15px rgba(0, 0, 0, 0.3)'
                  : 'none'
            }}
          >
            <div style={styles.componentIcon}>
              {getComponentIcon(component.type)}
            </div>
            <div style={styles.componentName}>{component.name}</div>
            <div style={styles.componentStatus}>
              {component.assembled ? '✓ 已组装' : component.processed ? '可拖拽' : '未加工'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatusBar({ 
  currentStep, 
  selectedTool, 
  onToolSelect, 
  onReset, 
  onEnterDisplay,
  assemblyComplete 
}: StatusBarProps) {
  
  const stepText: Record<string, string> = {
    select: '第一步：从左侧木料架选择紫檀木料',
    process: '第二步：使用刨子和凿子加工木料',
    assemble: '第三步：从右侧构件库拖拽构件进行组装',
    display: '完成！躺椅360度展示中'
  }
  
  return (
    <div style={styles.statusBar}>
      <div style={styles.statusText}>
        {stepText[currentStep] || '准备开始'}
      </div>
      
      <div style={styles.toolButtons}>
        <button
          style={{
            ...styles.toolButton,
            backgroundColor: selectedTool === 'plane' ? '#a0522d' : '#8b4513'
          }}
          onClick={() => onToolSelect(selectedTool === 'plane' ? null : 'plane')}
          disabled={currentStep !== 'process'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="8" width="18" height="8" rx="1" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="8" y1="16" x2="16" y2="16" />
          </svg>
          <span>刨子</span>
        </button>
        
        <button
          style={{
            ...styles.toolButton,
            backgroundColor: selectedTool === 'chisel' ? '#a0522d' : '#8b4513'
          }}
          onClick={() => onToolSelect(selectedTool === 'chisel' ? null : 'chisel')}
          disabled={currentStep !== 'process'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="2" x2="12" y2="14" />
            <polygon points="8,14 16,14 12,22" />
            <rect x="10" y="0" width="4" height="4" rx="1" />
          </svg>
          <span>凿子</span>
        </button>
      </div>
      
      <div style={styles.actionButtons}>
        <button
          style={styles.actionButton}
          onClick={onReset}
        >
          重置
        </button>
        
        {assemblyComplete && (
          <button
            style={{ ...styles.actionButton, backgroundColor: '#FFD700', color: '#4a3728' }}
            onClick={onEnterDisplay}
          >
            展示模式
          </button>
        )}
      </div>
    </div>
  )
}

export function LoadingSpinner({ visible }: LoadingSpinnerProps) {
  if (!visible) return null
  
  return (
    <div style={styles.loadingOverlay}>
      <div style={styles.loadingContent}>
        <div style={styles.spinningShaving}>
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              style={{
                ...styles.shavingParticle,
                animationDelay: `${i * 0.1}s`,
                transform: `rotate(${i * 45}deg)`
              }}
            />
          ))}
        </div>
        <div style={styles.loadingText}>正在准备木工作坊...</div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  materialPanel: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(139, 69, 19, 0.9)',
    borderRight: '3px solid #5c4033',
    padding: '20px 10px',
    overflowY: 'auto' as const,
    boxSizing: 'border-box' as const
  },
  
  panelTitle: {
    color: '#f5e6d0',
    fontSize: '22px',
    textAlign: 'center' as const,
    marginBottom: '20px',
    fontWeight: 'normal',
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
    letterSpacing: '2px'
  },
  
  materialGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '25px',
    alignItems: 'center' as const
  },
  
  materialItem: {
    width: '80px',
    height: '80px',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const
  },
  
  textureCanvas: {
    borderRadius: '4px',
    width: '70px',
    height: '70px'
  },
  
  materialTooltip: {
    position: 'absolute' as const,
    left: '100%',
    top: '50%',
    transform: 'translateY(-50%)',
    marginLeft: '15px',
    backgroundColor: 'rgba(74, 28, 14, 0.95)',
    color: '#f5e6d0',
    padding: '12px',
    borderRadius: '8px',
    minWidth: '160px',
    zIndex: 100,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
    border: '1px solid #8b4513'
  },
  
  tooltipName: {
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#FFD700',
    borderBottom: '1px solid rgba(255, 215, 0, 0.3)',
    paddingBottom: '5px'
  },
  
  tooltipRow: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: '8px',
    fontSize: '12px',
    marginBottom: '6px'
  },
  
  progressBar: {
    flex: 1,
    height: '6px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '3px',
    overflow: 'hidden' as const
  },
  
  progressFill: {
    height: '100%',
    backgroundColor: '#8b4513',
    borderRadius: '3px',
    transition: 'width 0.3s ease'
  },
  
  componentPanel: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(139, 69, 19, 0.9)',
    borderLeft: '3px solid #5c4033',
    padding: '20px 10px',
    overflowY: 'auto' as const,
    boxSizing: 'border-box' as const
  },
  
  componentList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '15px',
    alignItems: 'center' as const
  },
  
  componentCard: {
    width: '90%',
    backgroundColor: '#5c2a15',
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    transition: 'all 0.25s ease',
    border: '2px solid #3d1a0d'
  },
  
  componentIcon: {
    width: '50px',
    height: '50px',
    backgroundColor: '#8b4513',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    fontSize: '24px',
    color: '#f5e6d0',
    marginBottom: '8px',
    fontWeight: 'bold'
  },
  
  componentName: {
    color: '#f5e6d0',
    fontSize: '16px',
    marginBottom: '4px'
  },
  
  componentStatus: {
    color: '#c4a882',
    fontSize: '12px'
  },
  
  statusBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: '70px',
    backgroundColor: 'rgba(90, 60, 40, 0.95)',
    borderTop: '3px solid #5c4033',
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between',
    padding: '0 30px',
    zIndex: 50
  },
  
  statusText: {
    color: '#f5e6d0',
    fontSize: '18px',
    letterSpacing: '1px'
  },
  
  toolButtons: {
    display: 'flex',
    gap: '15px'
  },
  
  toolButton: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: '8px',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '6px',
    color: '#f5e6d0',
    fontSize: '16px',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    fontFamily: 'inherit'
  },
  
  actionButtons: {
    display: 'flex',
    gap: '15px'
  },
  
  actionButton: {
    padding: '10px 25px',
    border: 'none',
    borderRadius: '6px',
    backgroundColor: '#8b4513',
    color: '#f5e6d0',
    fontSize: '16px',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    fontFamily: 'inherit'
  },
  
  loadingOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(210, 180, 140, 0.95)',
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 1000
  },
  
  loadingContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    gap: '20px'
  },
  
  spinningShaving: {
    width: '80px',
    height: '80px',
    position: 'relative' as const,
    animation: 'spin 2s linear infinite'
  },
  
  shavingParticle: {
    position: 'absolute' as const,
    width: '20px',
    height: '4px',
    backgroundColor: '#f5e6d0',
    borderRadius: '2px',
    left: '50%',
    top: '50%',
    marginLeft: '-10px',
    marginTop: '-2px',
    animation: 'shaveFloat 1.5s ease-in-out infinite'
  },
  
  loadingText: {
    color: '#5c4033',
    fontSize: '20px',
    letterSpacing: '2px'
  }
}

const animationStyles = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  @keyframes shaveFloat {
    0%, 100% { opacity: 0.3; transform: rotate(inherit) translateX(0); }
    50% { opacity: 1; transform: rotate(inherit) translateX(15px); }
  }
  
  button:hover:not(:disabled) {
    background-color: #a0522d !important;
    transform: translateY(-2px);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  }
  
  button:active:not(:disabled) {
    background-color: #6b3410 !important;
    transform: translateY(0);
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed !important;
  }
`

if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style')
  styleElement.textContent = animationStyles
  document.head.appendChild(styleElement)
}
