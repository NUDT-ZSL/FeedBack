import React, { useState, useRef, useCallback } from 'react';
import EmbroideryCanvas, { EmbroideryCanvasHandle } from './components/EmbroideryCanvas';
import type { StitchType, ThreadColor, StitchSegment } from './types/embroidery';
import { THREAD_COLORS, STITCH_TYPES } from './types/embroidery';

const App: React.FC = () => {
  const canvasRef = useRef<EmbroideryCanvasHandle & { triggerSilkEffect?: () => void } | null>(null);
  const [stitchType, setStitchType] = useState<StitchType>('straight');
  const [threadColor, setThreadColor] = useState<ThreadColor>('#c0392b');
  const [stitchRadius] = useState(3);
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [selectedStitchIndex, setSelectedStitchIndex] = useState(0);
  const [inkRipplePos, setInkRipplePos] = useState<{ x: number; y: number; visible: boolean }>({ x: 0, y: 0, visible: false });
  const [showScroll, setShowScroll] = useState(false);
  const [scrollUnfolding, setScrollUnfolding] = useState(false);
  const [embroideryName, setEmbroideryName] = useState('牡丹绣品');
  const [embroideryImage, setEmbroideryImage] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [, setSegments] = useState<StitchSegment[]>([]);

  const handleStitchTypeChange = useCallback((index: number, type: StitchType, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setInkRipplePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      visible: true,
    });
    setTimeout(() => setInkRipplePos((prev) => ({ ...prev, visible: false })), 300);
    
    setSelectedStitchIndex(index);
    setStitchType(type);
  }, []);

  const handleColorChange = useCallback((index: number, color: ThreadColor) => {
    setSelectedColorIndex(index);
    setThreadColor(color);
  }, []);

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleClear = useCallback(() => {
    canvasRef.current?.clear();
  }, []);

  const handleComplete = useCallback(() => {
    if (!canvasRef.current) return;
    
    canvasRef.current.triggerSilkEffect?.();
    
    setTimeout(() => {
      const dataUrl = canvasRef.current?.exportImage(false) || '';
      setEmbroideryImage(dataUrl);
      
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setCreatedAt(timestamp);
      
      setScrollUnfolding(true);
      setShowScroll(true);
      
      setTimeout(() => setScrollUnfolding(false), 600);
    }, 500);
  }, []);

  const handleDownload = useCallback(() => {
    if (!embroideryImage) return;
    
    const link = document.createElement('a');
    const timestamp = Date.now();
    link.download = `绣品_${timestamp}.png`;
    link.href = embroideryImage;
    link.click();
  }, [embroideryImage]);

  const handleShareLink = useCallback(async () => {
    if (!canvasRef.current) return;
    
    const segments = canvasRef.current.getSegments();
    const data = {
      segments,
      name: embroideryName,
      createdAt: Date.now(),
    };
    
    try {
      const jsonStr = JSON.stringify(data);
      const base64 = btoa(encodeURIComponent(jsonStr));
      const shareUrl = `${window.location.origin}${window.location.pathname}?embroidery=${base64}`;
      
      await navigator.clipboard.writeText(shareUrl);
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 2000);
    } catch (e) {
      console.error('Failed to copy link:', e);
    }
  }, [embroideryName]);

  const handleSegmentsChange = useCallback((newSegments: StitchSegment[]) => {
    setSegments(newSegments);
  }, []);

  const formatTimestamp = (ts: string) => {
    return ts;
  };

  return (
    <div style={styles.app}>
      <h1 style={styles.title}>姑苏绣坊</h1>
      
      <div style={styles.mainContent}>
        <div style={styles.stitchToolbar}>
          {STITCH_TYPES.map((stitch, index) => (
            <button
              key={stitch.type}
              style={{
                ...styles.stitchButton,
                ...(selectedStitchIndex === index ? styles.stitchButtonActive : {}),
              }}
              onClick={(e) => handleStitchTypeChange(index, stitch.type, e)}
            >
              {inkRipplePos.visible && selectedStitchIndex === index && (
                <span
                  style={{
                    ...styles.inkRipple,
                    left: inkRipplePos.x,
                    top: inkRipplePos.y,
                  }}
                />
              )}
              <span style={styles.stitchButtonText}>{stitch.name}</span>
            </button>
          ))}
        </div>
        
        <div style={styles.canvasArea}>
          <EmbroideryCanvas
            ref={canvasRef as React.RefObject<EmbroideryCanvasHandle>}
            stitchType={stitchType}
            threadColor={threadColor}
            stitchRadius={stitchRadius}
            onSegmentsChange={handleSegmentsChange}
          />
          
          <div style={styles.controlButtons}>
            <button style={styles.controlButton} onClick={handleUndo} title="撤销">
              <svg viewBox="0 0 24 24" style={styles.controlIcon}>
                <rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="#5a3a1d" strokeWidth="1.5"/>
                <line x1="7" y1="7" x2="17" y2="7" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <line x1="7" y1="11" x2="15" y2="11" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <line x1="7" y1="15" x2="13" y2="15" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <path d="M8 19 Q12 22 16 19" fill="none" stroke="#5a3a1d" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            
            <button style={styles.controlButton} onClick={handleClear} title="清空">
              <svg viewBox="0 0 24 24" style={styles.controlIcon}>
                <line x1="12" y1="4" x2="12" y2="16" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round"/>
                <path d="M6 16 Q12 20 18 16" fill="none" stroke="#5a3a1d" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="8" y1="8" x2="6" y2="10" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <line x1="16" y1="8" x2="18" y2="10" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <line x1="10" y1="12" x2="8" y2="14" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
                <line x1="14" y1="12" x2="16" y2="14" stroke="#5a3a1d" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </button>
            
            <button style={styles.controlButton} onClick={handleComplete} title="完成刺绣">
              <svg viewBox="0 0 24 24" style={styles.controlIcon}>
                <rect x="6" y="6" width="12" height="14" rx="1" fill="none" stroke="#8b0000" strokeWidth="2"/>
                <path d="M9 9 L15 9 M9 12 L15 12 M9 15 L12 15" stroke="#8b0000" strokeWidth="1" strokeLinecap="round"/>
                <rect x="8" y="4" width="8" height="3" rx="0.5" fill="#c0392b"/>
              </svg>
            </button>
          </div>
        </div>
        
        <div style={styles.rightPanel}>
          <div style={styles.threadPalette}>
            <div style={styles.threadGrid}>
              {THREAD_COLORS.map((color, index) => (
                <button
                  key={color}
                  style={{
                    ...styles.threadButton,
                    backgroundColor: color,
                    ...(selectedColorIndex === index ? styles.threadButtonSelected : {}),
                  }}
                  onClick={() => handleColorChange(index, color)}
                />
              ))}
            </div>
            <div style={styles.colorPreview}>
              <span style={{ ...styles.colorPreviewBox, backgroundColor: threadColor }} />
              <span style={styles.colorPreviewLabel}>当前绣线</span>
            </div>
          </div>
          
          {showScroll && (
            <div style={{
              ...styles.scrollDisplay,
              ...(scrollUnfolding ? styles.scrollUnfolding : {}),
            }}>
              <div style={styles.scrollTop}>
                <div style={styles.scrollRod} />
                <div style={styles.scrollKnobLeft} />
                <div style={styles.scrollKnobRight} />
              </div>
              
              <div style={styles.scrollContent}>
                <h2 style={styles.embroideryTitle}>{embroideryName}</h2>
                <div style={styles.embroideryImageContainer}>
                  <img src={embroideryImage} alt="绣品" style={styles.embroideryImage} />
                </div>
                <div style={styles.embroideryInfo}>
                  <div style={styles.infoRow}>
                    <label style={styles.infoLabel}>作品名称：</label>
                    <input
                      type="text"
                      value={embroideryName}
                      onChange={(e) => setEmbroideryName(e.target.value)}
                      style={styles.nameInput}
                    />
                  </div>
                  <div style={styles.infoRow}>
                    <span style={styles.infoLabel}>创作时间：</span>
                    <span style={styles.infoValue}>{formatTimestamp(createdAt)}</span>
                  </div>
                </div>
                
                <div style={styles.shareButtons}>
                  <button style={styles.shareButton} onClick={handleDownload}>
                    <svg viewBox="0 0 24 24" style={styles.shareIcon}>
                      <path d="M12 3 L12 15 M7 10 L12 15 L17 10" fill="none" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5 19 L19 19" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span style={styles.shareButtonText}>下载PNG</span>
                  </button>
                  <button style={styles.shareButton} onClick={handleShareLink}>
                    <svg viewBox="0 0 24 24" style={styles.shareIcon}>
                      <path d="M10 13 L14 9" fill="none" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M7.5 15.5 Q9 17 11 17 Q13 17 14.5 15.5 L16.5 13.5 Q18 12 18 10 Q18 8 16.5 6.5 L15.5 5.5 Q14 4 12 4 Q10 4 8.5 5.5 L7.5 6.5" fill="none" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M16.5 8.5 Q15 7 13 7 Q11 7 9.5 8.5 L7.5 10.5 Q6 12 6 14 Q6 16 7.5 17.5 L8.5 18.5 Q10 20 12 20 Q14 20 15.5 18.5 L16.5 17.5" fill="none" stroke="#5a3a1d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={styles.shareButtonText}>复制链接</span>
                  </button>
                </div>
                
                <button style={styles.closeButton} onClick={() => setShowScroll(false)}>
                  关闭
                </button>
              </div>
              
              <div style={styles.scrollBottom}>
                <div style={styles.scrollRod} />
                <div style={styles.scrollKnobLeft} />
                <div style={styles.scrollKnobRight} />
              </div>
            </div>
          )}
        </div>
      </div>
      
      {showCopyToast && (
        <div style={styles.copyToast}>
          绣品链接已复制
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    width: '100%',
    minHeight: '100vh',
    backgroundColor: '#fcf5e8',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: "'Ma Shan Zheng', cursive",
  },
  title: {
    fontSize: '48px',
    color: '#8b5e3c',
    marginBottom: '20px',
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.1)',
    letterSpacing: '8px',
  },
  mainContent: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: '30px',
    flexWrap: 'wrap',
  },
  stitchToolbar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    paddingTop: '20px',
  },
  stitchButton: {
    position: 'relative',
    width: '100px',
    height: '50px',
    backgroundColor: '#e5d5b0',
    border: '2px solid #333',
    borderRadius: '8px',
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stitchButtonActive: {
    boxShadow: '0 0 12px #ffd700, 0 0 6px #ffd700',
    borderColor: '#8b5e3c',
  },
  stitchButtonText: {
    fontSize: '22px',
    color: '#333',
    position: 'relative',
    zIndex: 1,
  },
  inkRipple: {
    position: 'absolute',
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 70%)',
    transform: 'translate(-50%, -50%) scale(0)',
    animation: 'inkSpread 0.3s ease-out forwards',
    pointerEvents: 'none',
  },
  canvasArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  controlButtons: {
    display: 'flex',
    gap: '30px',
    justifyContent: 'center',
  },
  controlButton: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#e5d5b0',
    border: '2px solid #5a3a1d',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
    padding: 0,
  },
  controlIcon: {
    width: '24px',
    height: '24px',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: '200px',
  },
  threadPalette: {
    backgroundColor: '#e5d5b0',
    padding: '16px',
    borderRadius: '12px',
    border: '2px solid #8b5e3c',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  threadGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    marginBottom: '12px',
  },
  threadButton: {
    width: '50px',
    height: '50px',
    borderRadius: '50%',
    border: '3px solid rgba(255, 255, 255, 0.5)',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.3s ease',
    boxShadow: 'inset -4px -4px 8px rgba(0,0,0,0.2), inset 4px 4px 8px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)',
    padding: 0,
  },
  threadButtonSelected: {
    transform: 'scale(1.1)',
    boxShadow: 'inset -4px -4px 8px rgba(0,0,0,0.2), inset 4px 4px 8px rgba(255,255,255,0.3), 0 0 12px #ffd700, 0 2px 4px rgba(0,0,0,0.2)',
  },
  colorPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(139, 94, 60, 0.3)',
  },
  colorPreviewBox: {
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
  },
  colorPreviewLabel: {
    fontSize: '16px',
    color: '#5a3a1d',
  },
  scrollDisplay: {
    position: 'relative',
    backgroundColor: '#f5e6c8',
    borderRadius: '4px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
    animation: 'none',
  },
  scrollUnfolding: {
    animation: 'scrollUnfold 0.6s ease-out forwards',
  },
  scrollTop: {
    position: 'relative',
    height: '30px',
    backgroundColor: '#8b5e3c',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollRod: {
    width: '90%',
    height: '12px',
    backgroundColor: '#6b4423',
    borderRadius: '6px',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
  },
  scrollKnobLeft: {
    position: 'absolute',
    left: '5px',
    width: '16px',
    height: '24px',
    backgroundColor: '#d4af37',
    borderRadius: '4px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
  },
  scrollKnobRight: {
    position: 'absolute',
    right: '5px',
    width: '16px',
    height: '24px',
    backgroundColor: '#d4af37',
    borderRadius: '4px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
  },
  scrollContent: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    background: `
      linear-gradient(90deg, 
        rgba(139, 94, 60, 0.1) 0%, 
        transparent 5%, 
        transparent 95%, 
        rgba(139, 94, 60, 0.1) 100%
      ),
      linear-gradient(180deg, #f5e6c8 0%, #fcf5e8 100%)
    `,
  },
  embroideryTitle: {
    fontSize: '28px',
    color: '#8b5e3c',
    margin: 0,
    letterSpacing: '4px',
  },
  embroideryImageContainer: {
    width: '300px',
    height: '225px',
    backgroundColor: '#fcf5e8',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.1), 0 4px 8px rgba(0, 0, 0, 0.1)',
  },
  embroideryImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  embroideryInfo: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  infoLabel: {
    fontSize: '16px',
    color: '#5a3a1d',
    minWidth: '80px',
  },
  infoValue: {
    fontSize: '16px',
    color: '#333',
  },
  nameInput: {
    flex: 1,
    padding: '6px 12px',
    fontSize: '16px',
    fontFamily: "'Ma Shan Zheng', cursive",
    border: '1px solid #8b5e3c',
    borderRadius: '4px',
    backgroundColor: '#fcf5e8',
    color: '#333',
    outline: 'none',
  },
  shareButtons: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
  },
  shareButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#e5d5b0',
    border: '2px solid #8b5e3c',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontFamily: "'Ma Shan Zheng', cursive",
  },
  shareIcon: {
    width: '20px',
    height: '20px',
  },
  shareButtonText: {
    fontSize: '16px',
    color: '#5a3a1d',
  },
  closeButton: {
    padding: '8px 24px',
    backgroundColor: 'transparent',
    border: '1px solid #8b5e3c',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: "'Ma Shan Zheng', cursive",
    color: '#5a3a1d',
    transition: 'all 0.3s ease',
  },
  scrollBottom: {
    position: 'relative',
    height: '30px',
    backgroundColor: '#8b5e3c',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyToast: {
    position: 'fixed',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(90, 58, 29, 0.9)',
    color: '#fff',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '18px',
    zIndex: 1000,
    animation: 'fadeInOut 2s ease-in-out',
  },
};

const globalStyles = document.createElement('style');
globalStyles.textContent = `
  @keyframes inkSpread {
    0% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(2);
      opacity: 0;
    }
  }
  @keyframes scrollUnfold {
    0% {
      transform: scaleY(0);
      transform-origin: top;
    }
    100% {
      transform: scaleY(1);
      transform-origin: top;
    }
  }
  @keyframes fadeInOut {
    0% {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    15% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    85% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
  }
  
  button:hover {
    transform: translateY(-2px);
  }
  
  button:active {
    transform: translateY(0);
  }
  
  @media (max-width: 1024px) and (min-width: 768px) {
    .canvas-area {
      width: 80%;
    }
    .canvas-wrapper {
      width: 100% !important;
      height: auto !important;
      aspect-ratio: 4/3;
    }
  }
`;
document.head.appendChild(globalStyles);

export default App;
