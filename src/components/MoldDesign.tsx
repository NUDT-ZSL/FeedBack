import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mold } from '../types';

interface MoldDesignProps {
  selectedMold: Mold | null;
  drawingData: string;
  baked: boolean;
  onSelectMold: (mold: Mold) => void;
  onDrawingComplete: (drawingData: string, baked: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

const COLORS = ['#e91e63', '#ffc107', '#4caf50', '#2196f3', '#9c27b0', '#f44336'];

const MoldDesign: React.FC<MoldDesignProps> = ({
  selectedMold,
  drawingData,
  baked,
  onSelectMold,
  onDrawingComplete,
  onNext,
  onBack,
}) => {
  const [molds, setMolds] = useState<Mold[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [brushColor, setBrushColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(15);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isBaking, setIsBaking] = useState(false);
  const [isBaked, setIsBaked] = useState(baked);
  const [scale, setScale] = useState(1);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const rotationRef = useRef<number>(0);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const fetchMolds = async () => {
      try {
        const response = await fetch('/api/molds');
        const data = await response.json();
        setMolds(data);
      } catch (error) {
        console.error('Failed to fetch molds:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMolds();
  }, []);

  useEffect(() => {
    if (selectedMold && drawingData) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawMoldShape(ctx, selectedMold.shape, canvas.width, canvas.height, isBaked);
            ctx.drawImage(img, 0, 0);
          };
          img.src = drawingData;
        }
      }
    }
  }, [selectedMold, drawingData]);

  useEffect(() => {
    if (rotatingId) {
      const animate = () => {
        rotationRef.current += 2;
        if (rotationRef.current >= 720) {
          rotationRef.current = 0;
          setRotatingId(null);
          return;
        }
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [rotatingId]);

  const handleMoldClick = (mold: Mold) => {
    onSelectMold(mold);
    setRotatingId(mold.id);
    setIsBaked(false);
    onDrawingComplete('', false);
    
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawMoldShape(ctx, mold.shape, canvas.width, canvas.height, false);
        }
      }
    }, 100);
  };

  const drawMoldShape = (
    ctx: CanvasRenderingContext2D,
    shape: string,
    width: number,
    height: number,
    baked: boolean
  ) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.4 * scale;
    
    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius);
    if (baked) {
      gradient.addColorStop(0, '#ffd700');
      gradient.addColorStop(0.7, '#f4a460');
      gradient.addColorStop(1, '#d2691e');
    } else {
      gradient.addColorStop(0, '#fff8dc');
      gradient.addColorStop(0.7, '#f5deb3');
      gradient.addColorStop(1, '#deb887');
    }
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = baked ? '#8b4513' : '#d2b48c';
    ctx.lineWidth = 3;

    ctx.beginPath();
    switch (shape) {
      case 'circle':
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        break;
      case 'square':
        ctx.rect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        break;
      case 'plum':
        for (let i = 0; i < 5; i++) {
          const angle = (i * 72 - 90) * Math.PI / 180;
          const x = centerX + Math.cos(angle) * radius * 0.8;
          const y = centerY + Math.sin(angle) * radius * 0.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      case 'fan':
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
        ctx.closePath();
        break;
      case 'peach':
        ctx.moveTo(centerX, centerY + radius);
        ctx.bezierCurveTo(
          centerX - radius, centerY,
          centerX - radius, centerY - radius * 0.8,
          centerX, centerY - radius * 0.5
        );
        ctx.bezierCurveTo(
          centerX + radius, centerY - radius * 0.8,
          centerX + radius, centerY,
          centerX, centerY + radius
        );
        break;
      case 'animal':
        ctx.arc(centerX, centerY, radius * 0.7, 0, Math.PI * 2);
        ctx.moveTo(centerX - radius * 0.5, centerY - radius * 0.5);
        ctx.arc(centerX - radius * 0.5, centerY - radius * 0.5, radius * 0.25, 0, Math.PI * 2);
        ctx.moveTo(centerX + radius * 0.5, centerY - radius * 0.5);
        ctx.arc(centerX + radius * 0.5, centerY - radius * 0.5, radius * 0.25, 0, Math.PI * 2);
        break;
      default:
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  };

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedMold || isBaking) return;
    setIsDrawing(true);
    lastPosRef.current = getCanvasCoords(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !selectedMold || isBaking) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getCanvasCoords(e);
    const lastPos = lastPosRef.current;
    if (!lastPos) return;

    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = brushSize * 0.3;
    ctx.shadowColor = brushColor;

    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    
    const midX = (lastPos.x + pos.x) / 2;
    const midY = (lastPos.y + pos.y) / 2;
    ctx.quadraticCurveTo(lastPos.x, lastPos.y, midX, midY);
    
    ctx.stroke();
    ctx.shadowBlur = 0;

    lastPosRef.current = pos;
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      onDrawingComplete(canvas.toDataURL(), isBaked);
    }
  };

  const handleBake = () => {
    if (!selectedMold || isBaking || isBaked) return;
    setIsBaking(true);
    setScale(1);
    
    const startTime = Date.now();
    const duration = 2000;
    
    const animateBake = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      setScale(1 + progress * 0.1);
      
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const savedDrawing = canvas.toDataURL();
          drawMoldShape(ctx, selectedMold.shape, canvas.width, canvas.height, progress >= 1);
          
          if (drawingData) {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, 0, 0);
            };
            img.src = savedDrawing;
          }
        }
      }
      
      if (progress < 1) {
        requestAnimationFrame(animateBake);
      } else {
        setIsBaking(false);
        setIsBaked(true);
        const canvas = canvasRef.current;
        if (canvas) {
          onDrawingComplete(canvas.toDataURL(), true);
        }
      }
    };
    
    animateBake();
  };

  const clearCanvas = () => {
    if (!selectedMold || isBaking) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawMoldShape(ctx, selectedMold.shape, canvas.width, canvas.height, isBaked);
        onDrawingComplete('', isBaked);
      }
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>加载中...</div>
      </div>
    );
  }

  return (
    <div style={styles.container} className="page-transition">
      <h2 style={styles.title}>设计糕点造型</h2>
      
      <div style={styles.moldSection}>
        <h3 style={styles.sectionTitle}>选择模具</h3>
        <div style={styles.moldContainer} className="mold-container">
          {molds.map((mold) => (
            <div
              key={mold.id}
              style={{
                ...styles.moldCard,
                ...(selectedMold?.id === mold.id ? styles.moldCardSelected : {}),
                transform: rotatingId === mold.id 
                  ? `perspective(500px) rotateY(${rotationRef.current}deg)`
                  : 'none',
              }}
              onClick={() => handleMoldClick(mold)}
            >
              <div style={styles.moldPreview}>
                <MoldIcon shape={mold.shape} />
              </div>
              <p style={styles.moldName}>{mold.name}</p>
            </div>
          ))}
        </div>
      </div>

      {selectedMold && (
        <div style={styles.designSection}>
          <h3 style={styles.sectionTitle}>绘制图案</h3>
          
          <div style={styles.toolbar}>
            <div style={styles.colorPicker}>
              {COLORS.map((color) => (
                <div
                  key={color}
                  style={{
                    ...styles.colorOption,
                    backgroundColor: color,
                    ...(brushColor === color ? styles.colorOptionSelected : {}),
                  }}
                  onClick={() => setBrushColor(color)}
                />
              ))}
            </div>
            <div style={styles.sizeControl}>
              <span style={styles.sizeLabel}>笔触：</span>
              <input
                type="range"
                min="10"
                max="20"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                style={styles.sizeSlider}
              />
              <span style={styles.sizeValue}>{brushSize}px</span>
            </div>
            <button className="btn-ancient" onClick={clearCanvas} style={styles.clearBtn}>
              清除
            </button>
            <button
              className="btn-ancient"
              onClick={handleBake}
              disabled={isBaking || isBaked}
              style={styles.bakeBtn}
            >
              {isBaking ? '烧制中...' : isBaked ? '已烧制' : '烧制'}
            </button>
          </div>

          <div style={styles.canvasContainer}>
            <canvas
              ref={canvasRef}
              width={400}
              height={400}
              style={{
                ...styles.canvas,
                cursor: selectedMold && !isBaking ? 'crosshair' : 'default',
                transform: `scale(${scale})`,
                transition: isBaking ? 'none' : 'transform 0.1s',
              }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
            />
          </div>
        </div>
      )}

      <div style={styles.buttonBar}>
        <button className="btn-ancient" onClick={onBack} style={styles.backBtn}>
          返回
        </button>
        <button
          className="btn-ancient"
          onClick={onNext}
          disabled={!selectedMold || !isBaked}
          style={styles.nextBtn}
        >
          下一步
        </button>
      </div>

      <style>{`
        @keyframes checkmarkPop {
          0% { transform: scale(0); }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

const MoldIcon: React.FC<{ shape: string }> = ({ shape }) => {
  const iconStyle: React.CSSProperties = { width: '60px', height: '60px' };
  
  switch (shape) {
    case 'circle':
      return <div style={{ ...iconStyle, borderRadius: '50%', background: '#f5deb3' }} />;
    case 'square':
      return <div style={{ ...iconStyle, borderRadius: '8px', background: '#f5deb3' }} />;
    case 'plum':
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path d="M30 10 L45 25 L40 45 L20 45 L15 25 Z" fill="#f5deb3" stroke="#d2b48c" strokeWidth="2" />
        </svg>
      );
    case 'fan':
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path d="M30 50 A25 25 0 0 1 5 30 L30 30 Z" fill="#f5deb3" stroke="#d2b48c" strokeWidth="2" />
        </svg>
      );
    case 'peach':
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path 
            d="M30 50 C10 40 10 15 30 20 C50 15 50 40 30 50" 
            fill="#f5deb3" 
            stroke="#d2b48c" 
            strokeWidth="2" 
          />
        </svg>
      );
    case 'animal':
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="35" r="20" fill="#f5deb3" stroke="#d2b48c" strokeWidth="2" />
          <circle cx="15" cy="15" r="10" fill="#f5deb3" stroke="#d2b48c" strokeWidth="2" />
          <circle cx="45" cy="15" r="10" fill="#f5deb3" stroke="#d2b48c" strokeWidth="2" />
        </svg>
      );
    default:
      return <div style={{ ...iconStyle, borderRadius: '50%', background: '#f5deb3' }} />;
  }
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#f5e6d0',
  },
  loading: {
    fontSize: '24px',
    color: '#c0392b',
    marginTop: '100px',
  },
  title: {
    fontSize: '36px',
    color: '#c0392b',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '30px',
  },
  sectionTitle: {
    fontSize: '24px',
    color: '#333',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: '16px',
    textAlign: 'center',
  },
  moldSection: {
    marginBottom: '30px',
    width: '100%',
    maxWidth: '800px',
  },
  moldContainer: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    flexWrap: 'wrap',
    overflowX: 'auto',
    padding: '10px',
  },
  '@media (max-width: 768px)': {
    moldContainer: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      justifyContent: 'flex-start',
    },
  },
  moldCard: {
    width: '120px',
    padding: '16px',
    backgroundColor: '#fff9f0',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    border: '2px solid transparent',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flexShrink: 0,
  },
  moldCardSelected: {
    borderColor: '#d4ac0d',
    boxShadow: '0 4px 15px rgba(212, 172, 13, 0.3)',
  },
  moldPreview: {
    width: '60px',
    height: '60px',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moldName: {
    fontSize: '14px',
    color: '#333',
    fontFamily: "'Ma Shan Zheng', cursive",
  },
  designSection: {
    width: '100%',
    maxWidth: '500px',
    marginBottom: '30px',
  },
  toolbar: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    marginBottom: '20px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  colorPicker: {
    display: 'flex',
    gap: '8px',
  },
  colorOption: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    cursor: 'pointer',
    border: '3px solid transparent',
    transition: 'all 0.2s',
  },
  colorOptionSelected: {
    borderColor: '#333',
    transform: 'scale(1.1)',
  },
  sizeControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sizeLabel: {
    fontSize: '14px',
    color: '#333',
  },
  sizeSlider: {
    width: '100px',
  },
  sizeValue: {
    fontSize: '14px',
    color: '#666',
    minWidth: '35px',
  },
  clearBtn: {
    padding: '8px 16px',
    fontSize: '14px',
  },
  bakeBtn: {
    padding: '8px 16px',
    fontSize: '14px',
  },
  canvasContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: '20px',
    backgroundColor: '#fff9f0',
    borderRadius: '12px',
    border: '2px solid #d4ac0d',
  },
  canvas: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  buttonBar: {
    display: 'flex',
    gap: '20px',
    maxWidth: '500px',
    width: '100%',
    justifyContent: 'space-between',
  },
  backBtn: {
    minWidth: '120px',
  },
  nextBtn: {
    minWidth: '120px',
  },
};

export default MoldDesign;
