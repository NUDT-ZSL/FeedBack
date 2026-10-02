import React, { useState, useRef, useEffect, useCallback } from 'react'
import PaperCanvas, { PaperCanvasRef } from '@/components/PaperCanvas'
import Toolbar from '@/components/Toolbar'
import { Template } from '@/utils/cutLogic'
import { toPng } from 'html-to-image'

const App: React.FC = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [progress, setProgress] = useState(0)
  const [isCompleted, setIsCompleted] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  const canvasRef = useRef<PaperCanvasRef>(null)

  const scale = windowWidth < 768 ? 0.7 : 1

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo])

  const handleTemplateSelect = useCallback((template: Template) => {
    setSelectedTemplate(template)
    setIsCompleted(false)
    setProgress(0)
    setCanUndo(false)
  }, [])

  const handleProgressChange = useCallback((newProgress: number) => {
    setProgress(Math.min(newProgress, 1))
  }, [])

  const handleComplete = useCallback(() => {
    setIsCompleted(true)
  }, [])

  const handleUndo = useCallback(() => {
    if (canvasRef.current && canUndo) {
      canvasRef.current.undo()
    }
  }, [canUndo])

  const handleReset = useCallback(() => {
    if (canvasRef.current) {
      canvasRef.current.reset()
      setIsCompleted(false)
      setProgress(0)
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!canvasRef.current) return
    
    const canvas = canvasRef.current.getCanvasElement()
    if (!canvas) return

    try {
      const dataUrl = await toPng(canvas, {
        width: canvas.width,
        height: canvas.height,
        pixelRatio: 2
      })
      
      const link = document.createElement('a')
      link.download = `剪纸作品-${selectedTemplate?.name || '未命名'}-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (error) {
      console.error('保存失败:', error)
      const dataUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = `剪纸作品-${selectedTemplate?.name || '未命名'}-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    }
  }, [selectedTemplate])

  const handleUndoAvailable = useCallback((available: boolean) => {
    setCanUndo(available)
  }, [])

  const progressPercent = Math.round(progress * 100)

  return (
    <div className="app-container">
      <div className="light-overlay"></div>
      
      <header className="app-header">
        <h1 className="app-title">传统剪纸艺术</h1>
        <p className="app-subtitle">电子剪纸工坊 · 体验千年非遗文化</p>
      </header>

      <div className="progress-container">
        <div className="progress-label">
          <span>完成度</span>
          <span className="progress-value">{progressPercent}%</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {isCompleted && (
          <div className="completion-badge">
            ✨ 作品完成！
          </div>
        )}
      </div>

      <main className="main-content">
        <Toolbar
          selectedTemplate={selectedTemplate}
          onTemplateSelect={handleTemplateSelect}
          onUndo={handleUndo}
          onReset={handleReset}
          onSave={handleSave}
          canUndo={canUndo}
        />
        
        <div className="canvas-wrapper">
          {!selectedTemplate ? (
            <div className="placeholder">
              <div className="placeholder-icon">✂️</div>
              <p>请从左侧选择一个模板开始剪纸</p>
              <p className="placeholder-hint">点击并拖动鼠标在红纸上刻划</p>
            </div>
          ) : (
            <PaperCanvas
              ref={canvasRef}
              template={selectedTemplate}
              onProgressChange={handleProgressChange}
              onComplete={handleComplete}
              scale={scale}
              onUndoAvailable={handleUndoAvailable}
            />
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>提示：按住鼠标在红纸上拖动进行刻划 · 按 Ctrl+Z 撤销上一步</p>
      </footer>

      <style>{`
        .app-container {
          min-height: 100vh;
          background-color: #dbb896;
          background-image: 
            radial-gradient(ellipse at 30% 20%, rgba(255, 248, 231, 0.4) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, rgba(139, 94, 60, 0.3) 0%, transparent 50%),
            linear-gradient(135deg, #dbb896 0%, #c9a87c 50%, #b8956a 100%);
          position: relative;
          overflow-x: hidden;
        }

        .app-container::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
          opacity: 0.08;
          pointer-events: none;
          z-index: 0;
        }

        .light-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(ellipse at center top, #fff8e7 0%, transparent 60%),
                      radial-gradient(ellipse at center bottom, rgba(139, 94, 60, 0.2) 0%, transparent 50%);
          pointer-events: none;
          z-index: 1;
        }

        .app-header {
          position: relative;
          z-index: 10;
          text-align: center;
          padding: 24px 20px 16px;
        }

        .app-title {
          font-family: 'Ma Shan Zheng', cursive;
          font-size: 48px;
          color: #8b4513;
          text-shadow: 
            2px 2px 4px rgba(0, 0, 0, 0.2),
            0 0 20px rgba(255, 215, 0, 0.3);
          margin: 0;
          letter-spacing: 8px;
        }

        .app-subtitle {
          font-family: 'ZCOOL XiaoWei', serif;
          font-size: 18px;
          color: #5d4e37;
          margin-top: 8px;
          letter-spacing: 2px;
        }

        .progress-container {
          position: relative;
          z-index: 10;
          max-width: 500px;
          margin: 0 auto 24px;
          padding: 0 20px;
        }

        .progress-label {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-family: 'ZCOOL XiaoWei', serif;
          font-size: 16px;
          color: #5d4e37;
        }

        .progress-value {
          font-weight: bold;
          color: #c0392b;
        }

        .progress-bar {
          height: 12px;
          background: rgba(139, 94, 60, 0.3);
          border-radius: 6px;
          overflow: hidden;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #e74c3c, #f1c40f);
          border-radius: 6px;
          transition: width 0.3s ease;
          box-shadow: 0 0 10px rgba(241, 196, 15, 0.5);
        }

        .completion-badge {
          position: absolute;
          right: 20px;
          top: -8px;
          background: linear-gradient(135deg, #f1c40f, #f39c12);
          color: #fff;
          padding: 6px 16px;
          border-radius: 20px;
          font-family: 'Ma Shan Zheng', cursive;
          font-size: 18px;
          animation: bounce 0.6s ease infinite alternate;
          box-shadow: 0 4px 15px rgba(241, 196, 15, 0.6);
        }

        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-5px); }
        }

        .main-content {
          position: relative;
          z-index: 10;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          gap: 40px;
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .canvas-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          background: rgba(255, 248, 231, 0.3);
          border-radius: 16px;
          padding: 30px;
          box-shadow: 
            inset 0 0 30px rgba(139, 94, 60, 0.1),
            0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .placeholder {
          text-align: center;
          color: #8b5e3c;
          font-family: 'ZCOOL XiaoWei', serif;
        }

        .placeholder-icon {
          font-size: 64px;
          margin-bottom: 16px;
          animation: float 2s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .placeholder p {
          font-size: 20px;
          margin: 8px 0;
        }

        .placeholder-hint {
          font-size: 14px !important;
          opacity: 0.7;
        }

        .app-footer {
          position: relative;
          z-index: 10;
          text-align: center;
          padding: 20px;
          color: #5d4e37;
          font-family: 'ZCOOL XiaoWei', serif;
          font-size: 14px;
        }

        @media (max-width: 768px) {
          .app-title {
            font-size: 32px;
            letter-spacing: 4px;
          }

          .app-subtitle {
            font-size: 14px;
          }

          .main-content {
            flex-direction: column;
            align-items: center;
            gap: 20px;
          }

          .canvas-wrapper {
            padding: 20px;
            min-height: 320px;
          }

          .placeholder p {
            font-size: 16px;
          }

          .placeholder-icon {
            font-size: 48px;
          }
        }
      `}</style>
    </div>
  )
}

export default App
