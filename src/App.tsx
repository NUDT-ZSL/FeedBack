import React, { useState, useRef, useCallback } from 'react'
import PixelCanvas from './PixelCanvas'
import Palette from './Palette'
import Gallery from './Gallery'
import ArtDetail from './ArtDetail'
import type { Artwork, GridSize, Page } from './types'
import { addArtwork } from './db'

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('canvas')
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null)
  const [color, setColor] = useState('#e74c3c')
  const [opacity, setOpacity] = useState(1)
  const [brushSize, setBrushSize] = useState(1)
  const [gridSize, setGridSize] = useState<GridSize>(16)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [artworkName, setArtworkName] = useState('')
  const [galleryRefresh, setGalleryRefresh] = useState(0)

  const getCanvasDataRef = useRef<(() => string) | null>(null)
  const clearCanvasRef = useRef<(() => void) | null>(null)

  const handlePublish = useCallback(async () => {
    if (!getCanvasDataRef.current || !artworkName.trim()) return
    const data = getCanvasDataRef.current()
    if (!data) return
    await addArtwork({
      name: artworkName.trim(),
      data,
      gridSize,
      createdAt: Date.now(),
      likes: 0,
      liked: false,
      author: '访客用户',
    })
    setShowPublishModal(false)
    setArtworkName('')
    setGalleryRefresh((prev) => prev + 1)
    if (clearCanvasRef.current) {
      clearCanvasRef.current()
    }
    setCurrentPage('gallery')
  }, [artworkName, gridSize])

  const handleArtworkClick = (artwork: Artwork) => {
    setSelectedArtwork(artwork)
    setCurrentPage('detail')
  }

  const handleBackFromDetail = () => {
    setSelectedArtwork(null)
    setCurrentPage('gallery')
  }

  const addClickAnimations = () => {
    return `
      button:active {
        transform: scale(0.95);
        transition: transform 0.2s ease;
      }
      button:not(:active) {
        transition: transform 0.2s ease;
      }
      button {
        cursor: pointer !important;
      }
      input[type="range"] {
        cursor: pointer;
      }
      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        background: #5a4a3a;
        border-radius: 50%;
        cursor: pointer;
      }
    `
  }

  return (
    <div style={styles.app}>
      <style>{addClickAnimations()}</style>

      <nav style={styles.nav}>
        <h1 style={styles.logo}>🎨 像素涂鸦画廊</h1>
        <div style={styles.navBtns}>
          <button
            onClick={() => setCurrentPage('canvas')}
            style={{
              ...styles.navBtn,
              ...(currentPage === 'canvas' ? styles.navBtnActive : {}),
            }}
          >
            画板
          </button>
          <button
            onClick={() => setCurrentPage('gallery')}
            style={{
              ...styles.navBtn,
              ...(currentPage === 'gallery' ? styles.navBtnActive : {}),
            }}
          >
            画廊
          </button>
        </div>
      </nav>

      <main style={styles.main}>
        {currentPage === 'canvas' && (
          <div style={styles.canvasPage}>
            <Palette
              color={color}
              onColorChange={setColor}
              opacity={opacity}
              onOpacityChange={setOpacity}
              brushSize={brushSize}
              onBrushSizeChange={setBrushSize}
            />
            <PixelCanvas
              color={color}
              opacity={opacity}
              brushSize={brushSize}
              gridSize={gridSize}
              onGridSizeChange={setGridSize}
              getCanvasDataRef={getCanvasDataRef}
              clearCanvasRef={clearCanvasRef}
            />
            <div style={styles.rightPanel}>
              <button
                onClick={() => clearCanvasRef.current?.()}
                style={{ ...styles.actionBtn, ...styles.clearBtn }}
              >
                清空画布
              </button>
              <button
                onClick={() => setShowPublishModal(true)}
                style={{ ...styles.actionBtn, ...styles.publishBtn }}
              >
                ✨ 发布作品
              </button>
            </div>
          </div>
        )}

        {currentPage === 'gallery' && (
          <Gallery
            onArtworkClick={handleArtworkClick}
            refreshTrigger={galleryRefresh}
          />
        )}

        {currentPage === 'detail' && selectedArtwork && (
          <ArtDetail
            artwork={selectedArtwork}
            onBack={handleBackFromDetail}
          />
        )}
      </main>

      {showPublishModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h2 style={styles.modalTitle}>给你的作品起个名字</h2>
            <input
              type="text"
              value={artworkName}
              onChange={(e) => setArtworkName(e.target.value)}
              placeholder="输入作品名称..."
              style={styles.modalInput}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePublish()
              }}
            />
            <div style={styles.modalBtns}>
              <button
                onClick={() => {
                  setShowPublishModal(false)
                  setArtworkName('')
                }}
                style={{ ...styles.modalBtn, ...styles.modalBtnCancel }}
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                disabled={!artworkName.trim()}
                style={{
                  ...styles.modalBtn,
                  ...styles.modalBtnConfirm,
                  ...(!artworkName.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                }}
              >
                发布
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    width: '100%',
    minHeight: '100vh',
    backgroundColor: '#f5f0e8',
    display: 'flex',
    flexDirection: 'column',
  },
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    backgroundColor: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  logo: {
    fontSize: 22,
    fontWeight: 700,
    color: '#5a4a3a',
    margin: 0,
  },
  navBtns: {
    display: 'flex',
    gap: 8,
    backgroundColor: '#f5f0e8',
    padding: 4,
    borderRadius: 10,
  },
  navBtn: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: '#8b7355',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  navBtnActive: {
    backgroundColor: '#fff',
    color: '#5a4a3a',
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  },
  main: {
    flex: 1,
    padding: '32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  canvasPage: {
    display: 'flex',
    gap: 24,
    alignItems: 'flex-start',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: 140,
  },
  actionBtn: {
    padding: '14px 16px',
    border: 'none',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  clearBtn: {
    backgroundColor: '#fff',
    color: '#5a4a3a',
    border: '1px solid #d4c9b0',
  },
  publishBtn: {
    backgroundColor: '#5a4a3a',
    color: '#fff',
    boxShadow: '0 4px 12px rgba(90,74,58,0.25)',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(90, 74, 58, 0.3)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    width: 400,
    maxWidth: '90%',
    boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#5a4a3a',
    margin: '0 0 20px 0',
    textAlign: 'center',
  },
  modalInput: {
    width: '100%',
    padding: '14px 16px',
    border: '2px solid #d4c9b0',
    borderRadius: 10,
    fontSize: 15,
    outline: 'none',
    backgroundColor: '#faf7f2',
    color: '#5a4a3a',
    marginBottom: 20,
  },
  modalBtns: {
    display: 'flex',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    padding: '12px 20px',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  modalBtnCancel: {
    backgroundColor: '#f5f0e8',
    color: '#5a4a3a',
  },
  modalBtnConfirm: {
    backgroundColor: '#5a4a3a',
    color: '#fff',
  },
}

export default App
