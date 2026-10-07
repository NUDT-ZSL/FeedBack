import React, { useRef, useEffect, useState, useCallback } from 'react';
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
  isPointInPot,
  findNearestBranch,
  findNearestRock,
  findWaterPath,
  checkCollision,
  rerouteFlows
} from '../utils/pots';
import {
  drawPot,
  drawBranch,
  drawRock,
  drawWaterFlow,
  drawCalligraphy
} from '../utils/draw';
import { v4 as uuidv4 } from 'uuid';

interface WorkspaceProps {
  branches: Branch[];
  rocks: Rock[];
  waterFlows: WaterFlow[];
  calligraphies: Calligraphy[];
  particles: Particle[];
  ripples: Ripple[];
  activeTool: ToolType;
  selectedBranchId: string | null;
  selectedRockId: string | null;
  onBranchesChange: (branches: Branch[]) => void;
  onRocksChange: (rocks: Rock[]) => void;
  onWaterFlowsChange: (flows: WaterFlow[]) => void;
  onCalligraphiesChange: (calligraphies: Calligraphy[]) => void;
  onParticlesChange: (particles: Particle[]) => void;
  onRipplesChange: (ripples: Ripple[]) => void;
  onSelectBranch: (id: string | null) => void;
  onSelectRock: (id: string | null) => void;
  onTrim: () => void;
  isScrolling: boolean;
  waterStartPoint: Point | null;
  onWaterStartPointChange: (point: Point | null) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  panOffset: Point;
  onPanOffsetChange: (offset: Point) => void;
  onAddRipple: (x: number, y: number) => void;
  isDragging: boolean;
  onIsDraggingChange: (dragging: boolean) => void;
  dragStart: Point | null;
  onDragStartChange: (point: Point | null) => void;
  currentCalligraphy: Point[] | null;
  onCurrentCalligraphyChange: (points: Point[] | null) => void;
}

const Workspace: React.FC<WorkspaceProps> = ({
  branches,
  rocks,
  waterFlows,
  calligraphies,
  particles,
  ripples,
  activeTool,
  selectedBranchId,
  selectedRockId,
  onRocksChange,
  onWaterFlowsChange,
  onCalligraphiesChange,
  onParticlesChange,
  onRipplesChange,
  onSelectBranch,
  onSelectRock,
  onTrim,
  isScrolling,
  waterStartPoint,
  onWaterStartPointChange,
  scale,
  onScaleChange,
  panOffset,
  onPanOffsetChange,
  onAddRipple,
  isDragging,
  onIsDraggingChange,
  dragStart,
  onDragStartChange,
  currentCalligraphy,
  onCurrentCalligraphyChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [hoveredBranchId, setHoveredBranchId] = useState<string | null>(null);
  const [hoveredRockId, setHoveredRockId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [waterNotice, setWaterNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setWaterNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setWaterNotice(null);
      noticeTimerRef.current = null;
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const commitRocks = useCallback((nextRocks: Rock[]) => {
    onRocksChange(nextRocks);

    const rerouted = rerouteFlows(waterFlows, nextRocks);
    const blockedCount = rerouted.filter(f => f.blocked).length;
    const prevBlockedCount = waterFlows.filter(f => f.blocked).length;

    if (blockedCount !== prevBlockedCount) {
      showNotice(blockedCount > 0 ? '水流受阻，无法绕行' : '水流恢复畅通');
    }

    onWaterFlowsChange(rerouted);
  }, [onRocksChange, onWaterFlowsChange, waterFlows, showNotice]);

  const deleteSelectedRock = useCallback(() => {
    if (!selectedRockId) return;
    const rock = rocks.find(r => r.id === selectedRockId);
    if (!rock) return;
    commitRocks(rocks.filter(r => r.id !== selectedRockId));
    onSelectRock(null);
  }, [selectedRockId, rocks, commitRocks, onSelectRock]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTool !== 'rock' || !selectedRockId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedRock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, selectedRockId, deleteSelectedRock]);

  useEffect(() => {
    if (waterFlows.length === 0 && waterNotice) {
      setWaterNotice(null);
    }
  }, [waterFlows.length, waterNotice]);

  const getCanvasCoords = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / scale - panOffset.x;
    const y = (clientY - rect.top) / scale - panOffset.y;
    return { x, y };
  }, [scale, panOffset]);

  const drawParticle = useCallback((ctx: CanvasRenderingContext2D, particle: Particle) => {
    ctx.save();
    ctx.globalAlpha = particle.life / particle.maxLife;
    ctx.fillStyle = particle.color;
    
    if (particle.type === 'leaf') {
      ctx.beginPath();
      ctx.ellipse(
        particle.x, particle.y,
        particle.size, particle.size * 0.6,
        particle.vx * 0.5,
        0, Math.PI * 2
      );
      ctx.fill();
    } else {
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }, []);

  const drawRipple = useCallback((ctx: CanvasRenderingContext2D, ripple: Ripple) => {
    ctx.save();
    ctx.globalAlpha = ripple.life / ripple.maxLife;
    ctx.strokeStyle = '#c8e6c9';
    ctx.lineWidth = 2;
    
    const progress = 1 - ripple.life / ripple.maxLife;
    const currentRadius = ripple.maxRadius * progress;
    
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, currentRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, []);

  const drawWaterPreview = useCallback((ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 136, 229, 0.5)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(30, 136, 229, 0.8)';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.setLineDash([]);
    ctx.restore();
  }, []);

  const drawCalligraphyPreview = useCallback((ctx: CanvasRenderingContext2D, points: Point[]) => {
    if (points.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(74, 59, 50, 0.7)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }, []);

  const render = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const deltaTime = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-canvas.width / 2 + panOffset.x, -canvas.height / 2 + panOffset.y);
    
    drawPot(ctx);
    
    for (const flow of waterFlows) {
      drawWaterFlow(ctx, flow, time / 1000);
    }
    
    for (const branch of branches) {
      drawBranch(ctx, branch, branch.id === selectedBranchId, branch.id === hoveredBranchId);
    }
    
    for (const rock of rocks) {
      drawRock(ctx, rock, rock.id === selectedRockId, rock.id === hoveredRockId);
    }
    
    for (const calligraphy of calligraphies) {
      drawCalligraphy(ctx, calligraphy);
    }
    
    if (currentCalligraphy && currentCalligraphy.length > 0) {
      drawCalligraphyPreview(ctx, currentCalligraphy);
    }
    
    if (waterStartPoint && mousePos) {
      drawWaterPreview(ctx, waterStartPoint, mousePos);
    }
    
    for (const particle of particles) {
      drawParticle(ctx, particle);
    }
    
    for (const ripple of ripples) {
      drawRipple(ctx, ripple);
    }
    
    ctx.restore();
    
    if (deltaTime > 0 && deltaTime < 1) {
      const updatedParticles = particles
        .map(p => ({
          ...p,
          x: p.x + p.vx * deltaTime * 60,
          y: p.y + p.vy * deltaTime * 60,
          vy: p.type === 'leaf' ? p.vy + deltaTime * 60 * 0.1 : p.vy,
          life: p.life - deltaTime
        }))
        .filter(p => p.life > 0);
      
      if (updatedParticles.length !== particles.length || 
          updatedParticles.some((p, i) => p.x !== particles[i].x || p.y !== particles[i].y || p.life !== particles[i].life)) {
        onParticlesChange(updatedParticles);
      }
      
      const updatedRipples = ripples
        .map(r => ({ ...r, life: r.life - deltaTime }))
        .filter(r => r.life > 0);
      
      if (updatedRipples.length !== ripples.length ||
          updatedRipples.some((r, i) => r.life !== ripples[i].life)) {
        onRipplesChange(updatedRipples);
      }
      
      const updatedFlows = waterFlows.map(f => ({
        ...f,
        flowProgress: (f.flowProgress + deltaTime * 0.5) % 1
      }));
      
      if (updatedFlows.some((f, i) => f.flowProgress !== waterFlows[i].flowProgress)) {
        onWaterFlowsChange(updatedFlows);
      }
    }
    
    animationRef.current = requestAnimationFrame(render);
  }, [
    scale, panOffset, branches, rocks, waterFlows, calligraphies, particles, ripples,
    selectedBranchId, selectedRockId, hoveredBranchId, hoveredRockId,
    waterStartPoint, mousePos, currentCalligraphy,
    drawParticle, drawRipple, drawWaterPreview, drawCalligraphyPreview,
    onParticlesChange, onRipplesChange, onWaterFlowsChange
  ]);

  useEffect(() => {
    lastTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [render]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isScrolling) return;
    
    const coords = getCanvasCoords(e.clientX, e.clientY);
    onAddRipple(coords.x, coords.y);
    
    if (activeTool === 'scissors') {
      const branch = findNearestBranch(coords.x, coords.y, branches);
      if (branch) {
        if (selectedBranchId === branch.id) {
          onTrim();
        } else {
          onSelectBranch(branch.id);
          onSelectRock(null);
        }
      }
    } else if (activeTool === 'rock') {
      const rock = findNearestRock(coords.x, coords.y, rocks);
      if (rock) {
        onSelectRock(rock.id);
        onSelectBranch(null);
        onIsDraggingChange(true);
        onDragStartChange({ x: e.clientX, y: e.clientY });
      } else if (isPointInPot(coords.x, coords.y, POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 20)) {
        const newRock: Rock = {
          id: uuidv4(),
          x: coords.x,
          y: coords.y,
          diameter: 10 + Math.random() * 15,
          color: Math.random() > 0.5 ? '#607d8b' : '#8d6e63'
        };
        
        const hasCollision = rocks.some(r => 
          checkCollision(
            { x: newRock.x, y: newRock.y, radius: newRock.diameter / 2 },
            { x: r.x, y: r.y, radius: r.diameter / 2 }
          )
        );
        
        if (!hasCollision) {
          commitRocks([...rocks, newRock]);
        }
      }
    } else if (activeTool === 'water') {
      if (isPointInPot(coords.x, coords.y, POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 20)) {
        if (!waterStartPoint) {
          onWaterStartPointChange(coords);
        } else {
          const path = findWaterPath(waterStartPoint, coords, rocks, POT_RADIUS, POT_CENTER);
          if (path.length >= 2) {
            const newFlow: WaterFlow = {
              id: uuidv4(),
              path,
              flowProgress: 0,
              start: waterStartPoint,
              end: coords,
              blocked: false
            };
            onWaterFlowsChange([...waterFlows, newFlow]);
          } else {
            showNotice('水流受阻，无法绕行');
          }
          onWaterStartPointChange(null);
        }
      }
    } else if (activeTool === 'brush') {
      if (!isPointInPot(coords.x, coords.y, POT_CENTER.x, POT_CENTER.y, POT_RADIUS - 10)) {
        onCurrentCalligraphyChange([coords]);
        onIsDraggingChange(true);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e.clientX, e.clientY);
    setMousePos(coords);
    
    if (activeTool === 'scissors') {
      const branch = findNearestBranch(coords.x, coords.y, branches);
      setHoveredBranchId(branch?.id || null);
    } else if (activeTool === 'rock') {
      const rock = findNearestRock(coords.x, coords.y, rocks);
      setHoveredRockId(rock?.id || null);
      
      if (isDragging && selectedRockId && dragStart) {
        const dx = (e.clientX - dragStart.x) / scale;
        const dy = (e.clientY - dragStart.y) / scale;
        
        const updatedRocks = rocks.map(r => {
          if (r.id === selectedRockId) {
            let newX = r.x + dx;
            let newY = r.y + dy;
            
            const distFromCenter = Math.sqrt(
              Math.pow(newX - POT_CENTER.x, 2) + Math.pow(newY - POT_CENTER.y, 2)
            );
            if (distFromCenter > POT_RADIUS - r.diameter / 2 - 15) {
              const angle = Math.atan2(newY - POT_CENTER.y, newX - POT_CENTER.x);
              newX = POT_CENTER.x + Math.cos(angle) * (POT_RADIUS - r.diameter / 2 - 15);
              newY = POT_CENTER.y + Math.sin(angle) * (POT_RADIUS - r.diameter / 2 - 15);
            }
            
            return { ...r, x: newX, y: newY };
          }
          return r;
        });
        
        commitRocks(updatedRocks);
        onDragStartChange({ x: e.clientX, y: e.clientY });
      }
    } else if (activeTool === 'brush' && isDragging && currentCalligraphy) {
      onCurrentCalligraphyChange([...currentCalligraphy, coords]);
    } else if ((activeTool as ToolType) !== 'rock' && (activeTool as ToolType) !== 'brush' && isDragging && dragStart) {
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;
      onPanOffsetChange({ x: panOffset.x + dx, y: panOffset.y + dy });
      onDragStartChange({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    if (activeTool === 'brush' && currentCalligraphy && currentCalligraphy.length > 1) {
      const newCalligraphy: Calligraphy = {
        id: uuidv4(),
        points: currentCalligraphy,
        color: '#4a3b32',
        thickness: 6
      };
      onCalligraphiesChange([...calligraphies, newCalligraphy]);
    }
    
    onCurrentCalligraphyChange(null);
    onIsDraggingChange(false);
    onDragStartChange(null);
    setHoveredBranchId(null);
    setHoveredRockId(null);
  };

  const handleMouseLeave = () => {
    setMousePos(null);
    setHoveredBranchId(null);
    setHoveredRockId(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.5, Math.min(2, scale * delta));
    onScaleChange(newScale);
  };

  const canvasSize = typeof window !== 'undefined' && window.innerWidth < 768 ? 280 : 400;

  return (
    <div
      ref={containerRef}
      className={`workspace-canvas ${activeTool}-tool ${selectedBranchId ? 'has-selection' : ''}`}
      style={{ position: 'relative' }}
    >
      <div className={`pot-container ${isScrolling ? 'scroll-mode' : ''}`}>
        <canvas
          ref={canvasRef}
          width={canvasSize}
          height={canvasSize}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
        {waterNotice && (
          <div className="water-notice">{waterNotice}</div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
