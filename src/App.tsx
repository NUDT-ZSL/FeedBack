import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Branch,
  Rock,
  WaterFlow,
  Calligraphy,
  Particle,
  Ripple,
  ToolType,
  Point,
  POT_RADIUS,
  POT_CENTER,
  generateBranches,
  generateInitialRocks,
  calculateCompositionScore,
  createLeafParticles,
  createGoldParticles,
  calculatePathLength
} from './utils/pots';
import { v4 as uuidv4 } from 'uuid';
import Workspace from './components/Workspace';
import ToolPanel from './components/ToolPanel';
import confetti from 'canvas-confetti';

const App: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>(() => generateBranches());
  const [rocks, setRocks] = useState<Rock[]>(() => generateInitialRocks());
  const [waterFlows, setWaterFlows] = useState<WaterFlow[]>([]);
  const [calligraphies, setCalligraphies] = useState<Calligraphy[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  
  const [activeTool, setActiveTool] = useState<ToolType>('scissors');
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [selectedRockId, setSelectedRockId] = useState<string | null>(null);
  const [trimCount, setTrimCount] = useState(0);
  
  const [isScrolling, setIsScrolling] = useState(false);
  const [waterStartPoint, setWaterStartPoint] = useState<Point | null>(null);
  
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 });
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [currentCalligraphy, setCurrentCalligraphy] = useState<Point[] | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const compositionScore = calculateCompositionScore(branches, rocks, waterFlows);
  
  const totalWaterLength = waterFlows.reduce((sum, flow) => {
    return sum + calculatePathLength(flow.path);
  }, 0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const addRipple = useCallback((x: number, y: number) => {
    const newRipple: Ripple = {
      id: uuidv4(),
      x,
      y,
      radius: 0,
      maxRadius: 30,
      life: 0.4,
      maxLife: 0.4
    };
    setRipples(prev => [...prev, newRipple]);
  }, []);

  const handleTrim = useCallback(() => {
    if (!selectedBranchId) return;
    
    const branchToTrim = branches.find(b => b.id === selectedBranchId);
    if (!branchToTrim) return;
    
    const branchEndX = branchToTrim.endX;
    const branchEndY = branchToTrim.endY;
    
    const removeBranchAndChildren = (branchId: string): Branch[] => {
      return branches.filter(b => {
        if (b.id === branchId) return false;
        const isChild = branches.some(parent => 
          parent.id === branchId && 
          Math.abs(b.startX - parent.endX) < 5 && 
          Math.abs(b.startY - parent.endY) < 5
        );
        if (isChild) {
          removeBranchAndChildren(b.id);
        }
        return !isChild;
      });
    };
    
    const newBranches = branches.filter(b => {
      if (b.id === selectedBranchId) return false;
      
      const connectsToTrimmed = 
        Math.abs(b.startX - branchToTrim.endX) < 5 && 
        Math.abs(b.startY - branchToTrim.endY) < 5;
      
      return !connectsToTrimmed;
    });
    
    setBranches(newBranches);
    
    const newParticles = createLeafParticles(branchEndX, branchEndY, 20);
    setParticles(prev => {
      const maxParticles = 50;
      const combined = [...prev, ...newParticles];
      return combined.slice(-maxParticles);
    });
    
    setTrimCount(prev => prev + 1);
    setSelectedBranchId(null);
    
    confetti({
      particleCount: 15,
      spread: 60,
      origin: { x: 0.5, y: 0.5 },
      colors: ['#4caf50', '#81c784', '#a5d6a7']
    });
  }, [branches, selectedBranchId]);

  const handleReset = useCallback(() => {
    setBranches(generateBranches());
    setRocks(generateInitialRocks());
    setWaterFlows([]);
    setCalligraphies([]);
    setParticles([]);
    setRipples([]);
    setSelectedBranchId(null);
    setSelectedRockId(null);
    setTrimCount(0);
    setWaterStartPoint(null);
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handleScroll = useCallback(async () => {
    if (isScrolling) return;
    
    setIsScrolling(true);
    
    const goldParticles = createGoldParticles(POT_CENTER.x, POT_CENTER.y, 30);
    setParticles(prev => {
      const maxParticles = 50;
      const combined = [...prev, ...goldParticles];
      return combined.slice(-maxParticles);
    });
    
    confetti({
      particleCount: 30,
      spread: 100,
      startVelocity: 20,
      ticks: 100,
      origin: { x: 0.5, y: 0.3 },
      colors: ['#ffd700', '#ffeb3b', '#fff59d'],
      shapes: ['circle']
    });
    
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#f5f0e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 200;
    patternCanvas.height = 200;
    const patternCtx = patternCanvas.getContext('2d');
    if (patternCtx) {
      patternCtx.fillStyle = '#f5f0e8';
      patternCtx.fillRect(0, 0, 200, 200);
      patternCtx.globalAlpha = 0.03;
      for (let i = 0; i < 1000; i++) {
        patternCtx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
        patternCtx.fillRect(
          Math.random() * 200,
          Math.random() * 200,
          1, 1
        );
      }
      const pattern = ctx.createPattern(patternCanvas, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    
    ctx.save();
    ctx.translate(canvas.width / 2 - 200, canvas.height / 2 - 200);
    
    ctx.fillStyle = '#6b4423';
    ctx.beginPath();
    ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#3e2723';
    ctx.beginPath();
    ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 12, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 6, 0, Math.PI * 2);
    ctx.stroke();
    
    for (const flow of waterFlows) {
      if (flow.path.length < 2) continue;
      ctx.strokeStyle = '#1e88e5';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(flow.path[0].x, flow.path[0].y);
      for (let i = 1; i < flow.path.length; i++) {
        ctx.lineTo(flow.path[i].x, flow.path[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    
    for (const branch of branches) {
      ctx.strokeStyle = branch.color;
      ctx.lineWidth = branch.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(branch.startX, branch.startY);
      ctx.lineTo(branch.endX, branch.endY);
      ctx.stroke();
      
      if (branch.hasLeaves) {
        ctx.fillStyle = '#4caf50';
        const leafCount = 3 + Math.floor(branch.thickness / 2);
        for (let i = 0; i < leafCount; i++) {
          const t = (i + 1) / (leafCount + 1);
          const lx = branch.startX + (branch.endX - branch.startX) * t;
          const ly = branch.startY + (branch.endY - branch.startY) * t;
          
          const angle = Math.atan2(branch.endY - branch.startY, branch.endX - branch.startX);
          const offsetAngle = angle + Math.PI / 2;
          const offsetDist = branch.thickness + 3;
          
          const leafX = lx + Math.cos(offsetAngle) * offsetDist * (i % 2 === 0 ? 1 : -1);
          const leafY = ly + Math.sin(offsetAngle) * offsetDist * (i % 2 === 0 ? 1 : -1);
          
          ctx.beginPath();
          ctx.ellipse(leafX, leafY, 5, 2.5, offsetAngle, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    
    for (const rock of rocks) {
      const gradient = ctx.createRadialGradient(
        rock.x - rock.diameter * 0.2,
        rock.y - rock.diameter * 0.2,
        0,
        rock.x,
        rock.y,
        rock.diameter / 2
      );
      gradient.addColorStop(0, rock.color === '#607d8b' ? '#90a4ae' : '#a1887f');
      gradient.addColorStop(0.7, rock.color);
      gradient.addColorStop(1, rock.color === '#607d8b' ? '#455a64' : '#6d4c41');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const r = (rock.diameter / 2) * (0.8 + Math.sin(angle * 3 + rock.id.charCodeAt(0)) * 0.2);
        const px = rock.x + Math.cos(angle) * r;
        const py = rock.y + Math.sin(angle) * r;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.fill();
    }
    
    ctx.restore();
    
    for (const calligraphy of calligraphies) {
      if (calligraphy.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = calligraphy.color;
      ctx.lineWidth = calligraphy.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.85;
      
      ctx.beginPath();
      ctx.moveTo(
        calligraphy.points[0].x + canvas.width / 2 - 200,
        calligraphy.points[0].y + canvas.height / 2 - 200
      );
      
      for (let i = 1; i < calligraphy.points.length; i++) {
        ctx.lineTo(
          calligraphy.points[i].x + canvas.width / 2 - 200,
          calligraphy.points[i].y + canvas.height / 2 - 200
        );
      }
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.font = '48px "Ma Shan Zheng", cursive';
    ctx.fillStyle = '#4e342e';
    ctx.textAlign = 'center';
    ctx.fillText('盆景图卷', canvas.width / 2, 60);
    
    ctx.font = '24px "Noto Serif SC", serif';
    ctx.fillStyle = '#6b4423';
    ctx.fillText(`意境评分：${compositionScore.total}分`, canvas.width / 2, canvas.height - 40);
    
    ctx.font = '16px "Noto Serif SC", serif';
    ctx.fillStyle = '#8d6e63';
    const now = new Date();
    ctx.fillText(
      `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日制`,
      canvas.width / 2,
      canvas.height - 15
    );
    
    ctx.strokeStyle = '#d7ccc8';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 1;
    ctx.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
    
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `盆景图卷_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    
    setTimeout(() => {
      setIsScrolling(false);
    }, 500);
  }, [isScrolling, branches, rocks, waterFlows, calligraphies, compositionScore.total]);

  const handleToolChange = useCallback((tool: ToolType) => {
    setActiveTool(tool);
    setSelectedBranchId(null);
    setSelectedRockId(null);
    setWaterStartPoint(null);
    setCurrentCalligraphy(null);
  }, []);

  const handleParticlesChange = useCallback((newParticles: Particle[]) => {
    const maxParticles = 50;
    setParticles(newParticles.slice(-maxParticles));
  }, []);

  return (
    <div className="app-container">
      <div className={`loading-overlay ${!isLoading ? 'fade-out' : ''}`}>
        盆景工坊加载中...
      </div>
      
      <div className="top-bar">
        虚拟古代盆景工坊
      </div>
      
      <div className="main-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <ToolPanel
            activeTool={activeTool}
            onToolChange={handleToolChange}
            onReset={handleReset}
            onScroll={handleScroll}
            isScrolling={isScrolling}
          />
        </div>
        
        <div className="workspace-wrapper">
          <div className="workspace">
            <Workspace
              branches={branches}
              rocks={rocks}
              waterFlows={waterFlows}
              calligraphies={calligraphies}
              particles={particles}
              ripples={ripples}
              activeTool={activeTool}
              selectedBranchId={selectedBranchId}
              selectedRockId={selectedRockId}
              onBranchesChange={setBranches}
              onRocksChange={setRocks}
              onWaterFlowsChange={setWaterFlows}
              onCalligraphiesChange={setCalligraphies}
              onParticlesChange={handleParticlesChange}
              onRipplesChange={setRipples}
              onSelectBranch={setSelectedBranchId}
              onSelectRock={setSelectedRockId}
              onTrim={handleTrim}
              isScrolling={isScrolling}
              waterStartPoint={waterStartPoint}
              onWaterStartPointChange={setWaterStartPoint}
              scale={scale}
              onScaleChange={setScale}
              panOffset={panOffset}
              onPanOffsetChange={setPanOffset}
              onAddRipple={addRipple}
              isDragging={isDragging}
              onIsDraggingChange={setIsDragging}
              dragStart={dragStart}
              onDragStartChange={setDragStart}
              currentCalligraphy={currentCalligraphy}
              onCurrentCalligraphyChange={setCurrentCalligraphy}
            />
          </div>
        </div>
      </div>
      
      <div className="bottom-bar">
        <div className="stat-item">
          <span className="stat-label">意境分</span>
          <span className="stat-value">{compositionScore.total}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">修剪次数</span>
          <span className="stat-value">{trimCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">山石数</span>
          <span className="stat-value">{rocks.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">水流长度</span>
          <span className="stat-value">{Math.round(totalWaterLength)}px</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">枝叶疏密</span>
          <span className="stat-value">{compositionScore.branchScore}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">山石布局</span>
          <span className="stat-value">{compositionScore.rockScore}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">水流流畅</span>
          <span className="stat-value">{compositionScore.waterScore}</span>
        </div>
      </div>
      
      <canvas ref={canvasRef} className="hidden-canvas" />
    </div>
  );
};

export default App;
