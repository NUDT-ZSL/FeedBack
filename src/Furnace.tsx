import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Herb, Pill, Particle, DragState, FurnaceState, Element } from './types';
import { ELEMENT_COLORS } from './constants';
import { 
  mixFireColor, 
  calculateFlameHeight, 
  getSmokeColor, 
  getParticleRate,
  createPill,
  getBeamElements,
  clamp,
  lerp,
  hasGeneratingCombination
} from './utils';
import { audioManager } from './audio';

interface FurnaceProps {
  dragState: DragState;
  onIngredientAdded: (herb: Herb) => void;
  onPillCreated: (pill: Pill) => void;
  airflow: number;
  onAirflowChange: (value: number) => void;
}

const FURNACE_X = 0;
const FURNACE_Y = 0;
const FURNACE_WIDTH = 300;
const FURNACE_HEIGHT = 350;
const FEEDER_X = FURNACE_X + FURNACE_WIDTH / 2;
const FEEDER_Y = FURNACE_Y + 30;
const FURNACE_BODY_TOP = FURNACE_Y + 60;
const FURNACE_BODY_BOTTOM = FURNACE_Y + 320;
const FLAME_BASE_Y = FURNACE_Y + 280;
const JADE_BOX_WIDTH = 60;
const JADE_BOX_HEIGHT = 50;

const Furnace: React.FC<FurnaceProps> = ({
  dragState,
  onIngredientAdded,
  onPillCreated,
  airflow,
  onAirflowChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const particleIdRef = useRef<number>(0);
  const baguaRotationRef = useRef<number>(0);
  const lastParticleTimeRef = useRef<number>(0);
  const landscapeIndexRef = useRef<number>(0);
  const lastLandscapeTimeRef = useRef<number>(0);
  const landscapeTransitionRef = useRef<number>(0);
  
  const particlesRef = useRef<Particle[]>([]);
  const ingredientsRef = useRef<Herb[]>([]);
  const furnaceStateRef = useRef<FurnaceState>({
    temperature: 25,
    airFlow: 50,
    flameHeight: 80,
    flameColor: '#e74c3c',
    baseFireColor: '#e74c3c',
    currentElements: [],
    shakeTime: 0,
    beamTimes: [],
    beamElements: [null, null, null, null, null, null, null, null, null]
  });
  
  const [flyingPill, setFlyingPill] = useState<{
    pill: Pill;
    x: number;
    y: number;
    vy: number;
    vx: number;
    rotation: number;
    rotationSpeed: number;
    phase: 'rising' | 'falling';
  } | null>(null);
  
  const [jadeBoxOpen, setJadeBoxOpen] = useState(false);
  const [jadeBoxPos, setJadeBoxPos] = useState({ x: 0, y: 0 });
  const [caughtPill, setCaughtPill] = useState<Pill | null>(null);
  const [showGlow, setShowGlow] = useState(false);
  const [glowPos, setGlowPos] = useState({ x: 0, y: 0 });
  const [isDraggingBellows, setIsDraggingBellows] = useState(false);
  const [bellowsDragStart, setBellowsDragStart] = useState({ x: 0, value: 0 });
  const [mouseOverFeeder, setMouseOverFeeder] = useState(false);
  
  const canvasWidth = 900;
  const canvasHeight = 650;

  const addParticle = useCallback((particle: Omit<Particle, 'id'>) => {
    if (particlesRef.current.length >= 200) {
      particlesRef.current.shift();
    }
    particlesRef.current.push({
      ...particle,
      id: particleIdRef.current++
    });
  }, []);

  const drawTaotiePattern = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    
    const cx = x + w / 2;
    const cy = y + h / 2;
    
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.15, cy - h * 0.1, w * 0.08, h * 0.06, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.15, cy - h * 0.1, w * 0.08, h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.12, cy + h * 0.05);
    ctx.quadraticCurveTo(cx, cy + h * 0.2, cx + w * 0.12, cy + h * 0.05);
    ctx.quadraticCurveTo(cx, cy + h * 0.15, cx - w * 0.12, cy + h * 0.05);
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.25, cy - h * 0.05);
    ctx.quadraticCurveTo(cx - w * 0.35, cy - h * 0.2, cx - w * 0.2, cy - h * 0.25);
    ctx.moveTo(cx + w * 0.25, cy - h * 0.05);
    ctx.quadraticCurveTo(cx + w * 0.35, cy - h * 0.2, cx + w * 0.2, cy - h * 0.25);
    ctx.stroke();
    
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 4 + i * Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * w * 0.3, cy + Math.sin(angle) * h * 0.3);
      ctx.lineTo(cx + Math.cos(angle) * w * 0.4, cy + Math.sin(angle) * h * 0.4);
      ctx.stroke();
    }
    
    ctx.restore();
  }, []);

  const drawBagua = useCallback((ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, rotation: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.strokeStyle = '#ff6600';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    
    const innerR = radius * 0.5;
    const outerR = radius * 0.9;
    
    for (let i = 0; i < 8; i++) {
      const angle1 = (i * Math.PI * 2) / 8;
      const angle2 = ((i + 1) * Math.PI * 2) / 8;
      const midAngle = (angle1 + angle2) / 2;
      
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle1) * innerR, Math.sin(angle1) * innerR);
      ctx.lineTo(Math.cos(angle1) * outerR, Math.sin(angle1) * outerR);
      ctx.stroke();
      
      if (i % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(midAngle) * innerR, Math.sin(midAngle) * innerR);
        ctx.lineTo(Math.cos(midAngle) * outerR, Math.sin(midAngle) * outerR);
        ctx.stroke();
      }
    }
    
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.25, 0, Math.PI);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.25, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(0, -radius * 0.125, radius * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, radius * 0.125, radius * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    
    ctx.restore();
  }, []);

  const drawFlame = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, height: number, color: string, time: number) => {
    ctx.save();
    
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, height);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(0.6, color + '80');
    gradient.addColorStop(1, 'transparent');
    
    ctx.globalCompositeOperation = 'lighter';
    
    for (let i = 0; i < 5; i++) {
      const offsetX = Math.sin(time * 3 + i) * (height * 0.1);
      const flameHeight = height * (0.7 + Math.sin(time * 4 + i * 0.5) * 0.3);
      const width = height * (0.6 - i * 0.08);
      
      ctx.beginPath();
      ctx.moveTo(x - width / 2, y);
      ctx.quadraticCurveTo(
        x - width / 2 + offsetX * 0.5, 
        y - flameHeight * 0.5,
        x + offsetX,
        y - flameHeight
      );
      ctx.quadraticCurveTo(
        x + width / 2 + offsetX * 0.5, 
        y - flameHeight * 0.5,
        x + width / 2,
        y
      );
      ctx.closePath();
      
      gradient.addColorStop(0.2 + i * 0.1, color);
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.3 + i * 0.1;
      ctx.fill();
    }
    
    ctx.restore();
  }, []);

  const drawFurnace = useCallback((ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) => {
    const state = furnaceStateRef.current;
    const shakeX = state.shakeTime > 0 ? Math.sin(Date.now() * 0.1) * 3 : 0;
    const shakeY = state.shakeTime > 0 ? Math.cos(Date.now() * 0.15) * 2 : 0;
    
    const baseX = FURNACE_X + offsetX + shakeX;
    const baseY = FURNACE_Y + offsetY + shakeY;
    
    const bodyGradient = ctx.createLinearGradient(
      baseX, FURNACE_BODY_TOP,
      baseX + FURNACE_WIDTH, FURNACE_BODY_BOTTOM
    );
    bodyGradient.addColorStop(0, '#8b5a3c');
    bodyGradient.addColorStop(0.3, '#6b4c3a');
    bodyGradient.addColorStop(0.7, '#5c4033');
    bodyGradient.addColorStop(1, '#4a3728');
    
    ctx.save();
    
    ctx.beginPath();
    ctx.ellipse(
      baseX + FURNACE_WIDTH / 2,
      FURNACE_BODY_BOTTOM + 15,
      FURNACE_WIDTH / 2 + 20,
      20,
      0, 0, Math.PI * 2
    );
    ctx.fillStyle = '#3d2817';
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(baseX + 30, FURNACE_BODY_TOP + 20);
    ctx.quadraticCurveTo(
      baseX, FURNACE_BODY_TOP + 100,
      baseX + 20, FURNACE_BODY_BOTTOM
    );
    ctx.lineTo(baseX + FURNACE_WIDTH - 20, FURNACE_BODY_BOTTOM);
    ctx.quadraticCurveTo(
      baseX + FURNACE_WIDTH, FURNACE_BODY_TOP + 100,
      baseX + FURNACE_WIDTH - 30, FURNACE_BODY_TOP + 20
    );
    ctx.quadraticCurveTo(
      baseX + FURNACE_WIDTH / 2, FURNACE_BODY_TOP - 10,
      baseX + 30, FURNACE_BODY_TOP + 20
    );
    ctx.closePath();
    ctx.fillStyle = bodyGradient;
    ctx.fill();
    ctx.strokeStyle = '#3d2817';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    drawTaotiePattern(ctx, baseX + 40, FURNACE_BODY_TOP + 60, 80, 80);
    drawTaotiePattern(ctx, baseX + FURNACE_WIDTH - 120, FURNACE_BODY_TOP + 60, 80, 80);
    
    const lidGradient = ctx.createRadialGradient(
      baseX + FURNACE_WIDTH / 2, FEEDER_Y + 10,
      0,
      baseX + FURNACE_WIDTH / 2, FEEDER_Y + 10,
      FURNACE_WIDTH / 2
    );
    lidGradient.addColorStop(0, '#7a5040');
    lidGradient.addColorStop(1, '#4a3728');
    
    ctx.beginPath();
    ctx.ellipse(
      baseX + FURNACE_WIDTH / 2,
      FEEDER_Y + 10,
      FURNACE_WIDTH / 2 - 10,
      35,
      0, 0, Math.PI * 2
    );
    ctx.fillStyle = lidGradient;
    ctx.fill();
    ctx.strokeStyle = '#3d2817';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    const feederSize = mouseOverFeeder ? 20 : 10;
    ctx.beginPath();
    ctx.arc(baseX + FURNACE_WIDTH / 2, FEEDER_Y, feederSize, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
    
    if (mouseOverFeeder) {
      ctx.beginPath();
      ctx.arc(baseX + FURNACE_WIDTH / 2, FEEDER_Y, feederSize + 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 200, 100, ${0.5 + Math.sin(Date.now() * 0.01) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      
      const glowGradient = ctx.createRadialGradient(
        baseX + FURNACE_WIDTH / 2, FEEDER_Y, 0,
        baseX + FURNACE_WIDTH / 2, FEEDER_Y, feederSize + 15
      );
      glowGradient.addColorStop(0, 'rgba(255, 200, 100, 0.3)');
      glowGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(baseX + FURNACE_WIDTH / 2, FEEDER_Y, feederSize + 15, 0, Math.PI * 2);
      ctx.fill();
    }
    
    const holePositions = [];
    for (let i = 0; i < 9; i++) {
      const angle = (i * Math.PI * 2) / 9 - Math.PI / 2;
      const holeX = baseX + FURNACE_WIDTH / 2 + Math.cos(angle) * (FURNACE_WIDTH / 2 - 35);
      const holeY = FEEDER_Y + 10 + Math.sin(angle) * 25;
      holePositions.push({ x: holeX, y: holeY });
      
      ctx.beginPath();
      ctx.arc(holeX, holeY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = '#3d2817';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    
    for (let i = 0; i < 9; i++) {
      const beamTime = state.beamTimes[i] || 0;
      const beamElement = state.beamElements[i];
      if (beamTime > 0 && beamElement) {
        const beamProgress = 1 - beamTime / 2;
        const beamHeight = (30 + Math.sin(beamTime * 5) * 20) * (1 - beamProgress * 0.5);
        const beamColor = ELEMENT_COLORS[beamElement];
        
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - beamProgress;
        
        const beamGradient = ctx.createLinearGradient(
          holePositions[i].x, holePositions[i].y,
          holePositions[i].x, holePositions[i].y - beamHeight
        );
        beamGradient.addColorStop(0, beamColor);
        beamGradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = beamGradient;
        ctx.beginPath();
        ctx.moveTo(holePositions[i].x - 4, holePositions[i].y);
        ctx.lineTo(holePositions[i].x - 8, holePositions[i].y - beamHeight);
        ctx.lineTo(holePositions[i].x + 8, holePositions[i].y - beamHeight);
        ctx.lineTo(holePositions[i].x + 4, holePositions[i].y);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(holePositions[i].x, holePositions[i].y - beamHeight, 6, 0, Math.PI * 2);
        ctx.fillStyle = beamColor;
        ctx.fill();
        
        ctx.restore();
      }
    }
    
    ctx.beginPath();
    ctx.ellipse(
      baseX + FURNACE_WIDTH / 2,
      FLAME_BASE_Y + 10,
      80,
      15,
      0, 0, Math.PI * 2
    );
    ctx.fillStyle = '#2a1a0e';
    ctx.fill();
    
    ctx.restore();
    
    return { baseX, baseY, holePositions };
  }, [drawTaotiePattern, mouseOverFeeder]);

  const drawBellows = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, airFlow: number) => {
    ctx.save();
    
    const pullDistance = (airFlow / 100) * 40;
    
    const woodGradient = ctx.createLinearGradient(x, y, x + 100, y + 80);
    woodGradient.addColorStop(0, '#8b6914');
    woodGradient.addColorStop(0.3, '#a0522d');
    woodGradient.addColorStop(0.7, '#8b4513');
    woodGradient.addColorStop(1, '#654321');
    
    ctx.fillStyle = woodGradient;
    ctx.beginPath();
    ctx.moveTo(x, y + 20);
    ctx.lineTo(x + 60, y);
    ctx.lineTo(x + 60, y + 80);
    ctx.lineTo(x, y + 60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a3728';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 10 + i * 10, y + 5);
      ctx.lineTo(x + 10 + i * 10, y + 75);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    ctx.fillStyle = '#654321';
    ctx.fillRect(x - 8, y + 15, 12, 50);
    ctx.strokeStyle = '#4a3728';
    ctx.strokeRect(x - 8, y + 15, 12, 50);
    
    const handleX = x + 60 + pullDistance;
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(handleX + 20, y + 40, 15, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a3728';
    ctx.stroke();
    
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(handleX - 5, y + 35, 30, 10);
    ctx.strokeRect(handleX - 5, y + 35, 30, 10);
    
    ctx.fillStyle = '#3d2817';
    ctx.font = '14px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('风箱', x + 30, y + 100);
    
    ctx.restore();
    
    return { handleStartX: x + 55, handleEndX: x + 95, handleY: y + 30, handleWidth: 40, handleHeight: 50 };
  }, []);

  const drawJadeBox = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, isOpen: boolean) => {
    ctx.save();
    
    const boxGradient = ctx.createLinearGradient(x, y, x, y + JADE_BOX_HEIGHT);
    boxGradient.addColorStop(0, 'rgba(180, 220, 200, 0.7)');
    boxGradient.addColorStop(1, 'rgba(140, 180, 160, 0.5)');
    
    ctx.fillStyle = boxGradient;
    ctx.strokeStyle = 'rgba(100, 150, 130, 0.8)';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.roundRect(x, y + JADE_BOX_HEIGHT * 0.3, JADE_BOX_WIDTH, JADE_BOX_HEIGHT * 0.7, 5);
    ctx.fill();
    ctx.stroke();
    
    if (!isOpen) {
      const lidGradient = ctx.createLinearGradient(x, y, x, y + JADE_BOX_HEIGHT * 0.35);
      lidGradient.addColorStop(0, 'rgba(200, 230, 210, 0.8)');
      lidGradient.addColorStop(1, 'rgba(160, 200, 180, 0.6)');
      
      ctx.fillStyle = lidGradient;
      ctx.beginPath();
      ctx.roundRect(x, y, JADE_BOX_WIDTH, JADE_BOX_HEIGHT * 0.35, 5);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(212, 172, 13, 0.8)';
      ctx.beginPath();
      ctx.arc(x + JADE_BOX_WIDTH / 2, y + JADE_BOX_HEIGHT * 0.35, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(x + JADE_BOX_WIDTH / 2, y + JADE_BOX_HEIGHT * 0.3);
      ctx.rotate(-0.8);
      ctx.translate(-(x + JADE_BOX_WIDTH / 2), -(y + JADE_BOX_HEIGHT * 0.3));
      
      const lidGradient = ctx.createLinearGradient(x, y, x, y + JADE_BOX_HEIGHT * 0.35);
      lidGradient.addColorStop(0, 'rgba(200, 230, 210, 0.8)');
      lidGradient.addColorStop(1, 'rgba(160, 200, 180, 0.6)');
      
      ctx.fillStyle = lidGradient;
      ctx.beginPath();
      ctx.roundRect(x, y, JADE_BOX_WIDTH, JADE_BOX_HEIGHT * 0.35, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.fillStyle = 'rgba(100, 150, 130, 0.9)';
    ctx.font = '12px "Ma Shan Zheng", cursive';
    ctx.textAlign = 'center';
    ctx.fillText('玉盒', x + JADE_BOX_WIDTH / 2, y + JADE_BOX_HEIGHT + 18);
    
    ctx.restore();
  }, []);

  const drawLandscape = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    ctx.save();
    
    if (time - lastLandscapeTimeRef.current > 8000) {
      landscapeIndexRef.current = (landscapeIndexRef.current + 1) % 6;
      lastLandscapeTimeRef.current = time;
      landscapeTransitionRef.current = 0;
    }
    
    if (landscapeTransitionRef.current < 1) {
      landscapeTransitionRef.current = Math.min(1, landscapeTransitionRef.current + 0.016);
    }
    
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#1a2a1a');
    bgGradient.addColorStop(0.5, '#0f1a0f');
    bgGradient.addColorStop(1, '#1a2a1a');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);
    
    const seed = landscapeIndexRef.current;
    
    ctx.strokeStyle = `rgba(30, 60, 40, ${0.3 + Math.sin(time * 0.0001) * 0.1})`;
    ctx.lineWidth = 2;
    
    for (let layer = 0; layer < 3; layer++) {
      const alpha = 0.15 + layer * 0.1;
      const yOffset = height * (0.3 + layer * 0.2);
      
      ctx.beginPath();
      ctx.moveTo(0, yOffset + 50);
      
      for (let x = 0; x <= width; x += 20) {
        const noise = Math.sin(x * 0.01 + seed + layer * 0.5) * 40 
                    + Math.sin(x * 0.02 + seed * 2) * 20
                    + Math.sin(x * 0.005 + seed * 0.5) * 60;
        ctx.lineTo(x, yOffset - noise * (0.5 + layer * 0.25));
      }
      
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      
      ctx.fillStyle = `rgba(20, 40, 30, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(40, 80, 60, ${alpha * 0.5})`;
      ctx.stroke();
    }
    
    for (let i = 0; i < 5; i++) {
      const tx = (seed * 137 + i * 211) % width;
      const ty = height * (0.4 + (seed * 17 + i * 23) % 3 * 0.15);
      
      ctx.fillStyle = `rgba(25, 50, 35, 0.4)`;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 15, ty + 40);
      ctx.lineTo(tx + 15, ty + 40);
      ctx.closePath();
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(tx, ty - 15);
      ctx.lineTo(tx - 12, ty + 20);
      ctx.lineTo(tx + 12, ty + 20);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = 'rgba(60, 40, 30, 0.6)';
      ctx.fillRect(tx - 3, ty + 35, 6, 15);
    }
    
    ctx.strokeStyle = 'rgba(60, 100, 80, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    const riverSeed = seed * 31;
    for (let x = 0; x <= width; x += 10) {
      const y = height * 0.75 + Math.sin(x * 0.008 + riverSeed) * 20;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(180, 200, 190, 0.15)';
    ctx.fill();
    
    if (landscapeTransitionRef.current < 1 && landscapeTransitionRef.current > 0) {
      const splatterAlpha = 1 - Math.abs(landscapeTransitionRef.current - 0.5) * 2;
      for (let i = 0; i < 20; i++) {
        const sx = Math.random() * width;
        const sy = Math.random() * height;
        const sr = Math.random() * 40 + 10;
        
        const splatter = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        splatter.addColorStop(0, `rgba(0, 0, 0, ${splatterAlpha * 0.5})`);
        splatter.addColorStop(1, 'transparent');
        ctx.fillStyle = splatter;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    ctx.restore();
  }, []);

  const drawDragonPillar = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, height: number, mouseX: number, mouseY: number) => {
    ctx.save();
    
    const dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - (y + height / 2), 2));
    const eyeBrightness = dist < 150 ? 0.3 + (1 - dist / 150) * 0.5 : 0.3;
    
    const pillarGradient = ctx.createLinearGradient(x - 25, y, x + 25, y);
    pillarGradient.addColorStop(0, 'rgba(80, 50, 30, 0.4)');
    pillarGradient.addColorStop(0.5, 'rgba(120, 80, 50, 0.3)');
    pillarGradient.addColorStop(1, 'rgba(80, 50, 30, 0.4)');
    
    ctx.fillStyle = pillarGradient;
    ctx.beginPath();
    ctx.roundRect(x - 25, y, 50, height, 10);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(180, 140, 80, 0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const py = y + t * height;
      const px = x + Math.sin(t * Math.PI * 3) * 15;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    
    const headY = y + 30;
    ctx.fillStyle = 'rgba(180, 140, 80, 0.7)';
    ctx.beginPath();
    ctx.ellipse(x, headY, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = `rgba(255, 200, 100, ${eyeBrightness})`;
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 10 * eyeBrightness;
    ctx.beginPath();
    ctx.arc(x - 6, headY - 2, 3, 0, Math.PI * 2);
    ctx.arc(x + 6, headY - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = 'rgba(180, 140, 80, 0.7)';
    ctx.beginPath();
    ctx.moveTo(x - 10, headY - 10);
    ctx.lineTo(x - 5, headY - 20);
    ctx.lineTo(x - 2, headY - 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 10, headY - 10);
    ctx.lineTo(x + 5, headY - 20);
    ctx.lineTo(x + 2, headY - 12);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = 'rgba(180, 140, 80, 0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y + height - 25, 20, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }, []);

  const render = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (dragState.currentX - rect.left) * scaleX;
    const mouseY = (dragState.currentY - rect.top) * scaleY;
    
    const containerRect = container.getBoundingClientRect();
    const offsetX = (containerRect.width - FURNACE_WIDTH) / 2 - 100;
    const offsetY = 50;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawLandscape(ctx, canvas.width, canvas.height, time);
    
    drawDragonPillar(ctx, 60, 50, canvas.height - 100, mouseX, mouseY);
    drawDragonPillar(ctx, canvas.width - 60, 50, canvas.height - 100, mouseX, mouseY);
    
    baguaRotationRef.current += (deltaTime / 1000) * (Math.PI * 2 / 30);
    drawBagua(ctx, offsetX + FURNACE_WIDTH / 2, FLAME_BASE_Y + 50, 120, baguaRotationRef.current);
    
    const furnaceResult = drawFurnace(ctx, offsetX, offsetY);
    
    const state = furnaceStateRef.current;
    
    state.temperature = lerp(state.temperature, 20 + airflow * 0.8, 0.02);
    
    drawFlame(
      ctx,
      offsetX + FURNACE_WIDTH / 2,
      FLAME_BASE_Y,
      state.flameHeight,
      state.flameColor,
      time / 1000
    );
    
    const particleRate = getParticleRate(state.temperature);
    if (time - lastParticleTimeRef.current > 1000 / particleRate) {
      lastParticleTimeRef.current = time;
      
      for (let i = 0; i < 9; i++) {
        const angle = (i * Math.PI * 2) / 9 - Math.PI / 2;
        const holeX = offsetX + FURNACE_WIDTH / 2 + Math.cos(angle) * (FURNACE_WIDTH / 2 - 35);
        const holeY = FEEDER_Y + 10 + Math.sin(angle) * 25;
        
        addParticle({
          x: holeX + (Math.random() - 0.5) * 8,
          y: holeY,
          vx: (Math.random() - 0.5) * 1,
          vy: -Math.random() * 3 - 2,
          life: 60 + Math.random() * 40,
          maxLife: 100,
          size: 3 + Math.random() * 4,
          color: getSmokeColor(state.temperature),
          type: 'smoke'
        });
      }
      
      for (let i = 0; i < 3; i++) {
        addParticle({
          x: offsetX + FURNACE_WIDTH / 2 + (Math.random() - 0.5) * 40,
          y: FLAME_BASE_Y - 20,
          vx: (Math.random() - 0.5) * 2,
          vy: -Math.random() * 5 - 3,
          life: 20 + Math.random() * 20,
          maxLife: 40,
          size: 2 + Math.random() * 3,
          color: state.flameColor,
          type: 'spark'
        });
      }
    }
    
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      
      p.x += p.vx;
      p.y += p.vy;
      
      if (p.type === 'smoke') {
        p.vy -= 0.02;
        p.vx += (Math.random() - 0.5) * 0.1;
      } else if (p.type === 'spark') {
        p.vy += 0.15;
      } else if (p.type === 'ingredient') {
        p.vy += 0.3;
      } else if (p.type === 'aura') {
        p.vx += Math.cos(p.life * 0.1) * 0.5;
        p.vy += Math.sin(p.life * 0.1) * 0.5;
      } else if (p.type === 'ring') {
        p.size += 2;
      }
      
      p.life--;
      
      if (p.life <= 0) {
        particlesRef.current.splice(i, 1);
        continue;
      }
      
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      
      if (p.type === 'smoke') {
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ingredient') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'aura') {
        ctx.globalCompositeOperation = 'lighter';
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      ctx.restore();
    }
    
    if (state.shakeTime > 0) {
      state.shakeTime -= deltaTime;
    }
    
    for (let i = 0; i < 9; i++) {
      if (state.beamTimes[i] > 0) {
        state.beamTimes[i] -= deltaTime / 1000;
      }
    }
    
    const bellowsX = offsetX - 130;
    const bellowsY = FURNACE_BODY_TOP + 80;
    const bellowsBounds = drawBellows(ctx, bellowsX, bellowsY, airflow);
    
    const jadeBoxX = offsetX + FURNACE_WIDTH / 2 - JADE_BOX_WIDTH / 2;
    const jadeBoxY = FLAME_BASE_Y + 80;
    setJadeBoxPos({ x: jadeBoxX + containerRect.left, y: jadeBoxY + containerRect.top });
    drawJadeBox(ctx, jadeBoxX, jadeBoxY, jadeBoxOpen);
    
    if (flyingPill) {
      const fp = flyingPill;
      ctx.save();
      ctx.translate(fp.x, fp.y);
      ctx.rotate(fp.rotation);
      ctx.translate(-fp.x, -fp.y);
      
      const glow = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, 25);
      glow.addColorStop(0, fp.pill.glowColor + '80');
      glow.addColorStop(0.5, fp.pill.color + '40');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 25, 0, Math.PI * 2);
      ctx.fill();
      
      const pillGradient = ctx.createRadialGradient(fp.x - 3, fp.y - 3, 0, fp.x, fp.y, 12);
      pillGradient.addColorStop(0, '#fff');
      pillGradient.addColorStop(0.3, fp.pill.color);
      pillGradient.addColorStop(1, fp.pill.color + '80');
      ctx.fillStyle = pillGradient;
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, 12, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
    
    if (showGlow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(glowPos.x, glowPos.y, 0, glowPos.x, glowPos.y, 60);
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
      glow.addColorStop(0.5, 'rgba(255, 215, 0, 0.3)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(glowPos.x, glowPos.y, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    
    if (dragState.isDragging && dragState.herb) {
      const herbCanvasX = (dragState.currentX - rect.left) * scaleX;
      const herbCanvasY = (dragState.currentY - rect.top) * scaleY;
      
      const feederScreenX = furnaceResult.baseX + FURNACE_WIDTH / 2;
      const feederScreenY = FEEDER_Y;
      const distToFeeder = Math.sqrt(
        Math.pow(herbCanvasX - feederScreenX, 2) + 
        Math.pow(herbCanvasY - feederScreenY, 2)
      );
      setMouseOverFeeder(distToFeeder < 40);
    } else {
      setMouseOverFeeder(false);
    }
    
    animationRef.current = requestAnimationFrame(render);
  }, [addParticle, dragState, drawBagua, drawBellows, drawDragonPillar, drawFlame, drawFurnace, drawJadeBox, drawLandscape, flyingPill, jadeBoxOpen, mouseOverFeeder, airflow, glowPos, showGlow]);

  const handleIngredientDrop = useCallback(() => {
    if (!dragState.isDragging || !dragState.herb) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const rect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const offsetX = (containerRect.width - FURNACE_WIDTH) / 2 - 100;
    
    const herbCanvasX = (dragState.currentX - rect.left) * scaleX;
    const herbCanvasY = (dragState.currentY - rect.top) * scaleY;
    
    const feederX = offsetX + FURNACE_WIDTH / 2;
    const feederY = FEEDER_Y;
    const distToFeeder = Math.sqrt(
      Math.pow(herbCanvasX - feederX, 2) + 
      Math.pow(herbCanvasY - feederY, 2)
    );
    
    if (distToFeeder < 40) {
      const herb = dragState.herb;
      ingredientsRef.current.push(herb);
      onIngredientAdded(herb);
      
      const state = furnaceStateRef.current;
      state.flameColor = mixFireColor(state.flameColor, herb.element);
      state.currentElements = [...new Set([...state.currentElements, herb.element])];
      state.flameHeight = calculateFlameHeight(80, airflow, state.currentElements);
      state.shakeTime = 300;
      
      for (let i = 0; i < 10; i++) {
        addParticle({
          x: feederX + (Math.random() - 0.5) * 20,
          y: feederY,
          vx: (Math.random() - 0.5) * 4,
          vy: Math.random() * -2 - 1,
          life: 30,
          maxLife: 30,
          size: 4 + Math.random() * 4,
          color: herb.color,
          type: 'ingredient'
        });
      }
      
      audioManager.playDropSound();
      audioManager.updateFurnaceSound(airflow, state.temperature);
      
      const uniqueElements = [...new Set(ingredientsRef.current.map(i => i.element))];
      if (hasGeneratingCombination(uniqueElements) && ingredientsRef.current.length >= 2) {
        const pill = createPill(
          ingredientsRef.current,
          state.temperature,
          airflow
        );
        
        if (pill) {
          state.beamElements = getBeamElements(uniqueElements);
          state.beamTimes = [2, 2, 2, 2, 2, 2, 2, 2, 2];
          
          setTimeout(() => {
            setFlyingPill({
              pill,
              x: feederX,
              y: feederY - 20,
              vy: -8,
              vx: (Math.random() - 0.5) * 2,
              rotation: 0,
              rotationSpeed: (Math.random() - 0.5) * 0.3,
              phase: 'rising'
            });
            audioManager.playSuccessSound();
          }, 1000);
          
          ingredientsRef.current = [];
          state.currentElements = [];
        }
      }
    }
  }, [dragState, airflow, addParticle, onIngredientAdded]);

  useEffect(() => {
    if (!flyingPill) return;
    
    const interval = setInterval(() => {
      setFlyingPill(prev => {
        if (!prev) return null;
        
        let newVy = prev.vy;
        let newPhase = prev.phase;
        
        if (prev.phase === 'rising') {
          newVy += 0.3;
          if (prev.vy >= 0 && prev.y < FEEDER_Y - 80) {
            newPhase = 'falling';
          }
        } else {
          newVy += 0.4;
        }
        
        const newY = prev.y + newVy;
        const newX = prev.x + prev.vx;
        const newRotation = prev.rotation + prev.rotationSpeed;
        
        const container = containerRef.current;
        if (!container) return prev;
        
        const containerRect = container.getBoundingClientRect();
        const offsetX = (containerRect.width - FURNACE_WIDTH) / 2 - 100;
        const jadeBoxScreenX = offsetX + FURNACE_WIDTH / 2 - JADE_BOX_WIDTH / 2;
        const jadeBoxScreenY = FLAME_BASE_Y + 80;
        
        if (prev.phase === 'falling' && 
            newY > jadeBoxScreenY && 
            newY < jadeBoxScreenY + JADE_BOX_HEIGHT &&
            newX > jadeBoxScreenX && 
            newX < jadeBoxScreenX + JADE_BOX_WIDTH) {
          
          addParticle({
            x: newX,
            y: newY,
            vx: 0,
            vy: 0,
            life: 30,
            maxLife: 30,
            size: 10,
            color: 'rgba(255, 215, 0, 0.8)',
            type: 'ring'
          });
          
          setCaughtPill(prev.pill);
          setShowGlow(true);
          setGlowPos({ x: newX, y: newY });
          setTimeout(() => {
            setShowGlow(false);
            onPillCreated(prev.pill);
          }, 500);
          
          return null;
        }
        
        if (newY > canvasHeight + 50) {
          return null;
        }
        
        return {
          ...prev,
          x: newX,
          y: newY,
          vy: newVy,
          rotation: newRotation,
          phase: newPhase
        };
      });
    }, 16);
    
    return () => clearInterval(interval);
  }, [flyingPill, addParticle, onPillCreated]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDraggingBellows) {
      const container = containerRef.current;
      if (!container) return;
      
      const containerRect = container.getBoundingClientRect();
      const offsetX = (containerRect.width - FURNACE_WIDTH) / 2 - 100;
      const bellowsX = offsetX - 130;
      
      const minX = bellowsX + 55;
      const maxX = bellowsX + 95;
      const currentX = e.clientX - containerRect.left;
      
      const newValue = clamp(
        bellowsDragStart.value + (currentX - bellowsDragStart.x) * 2.5,
        0,
        100
      );
      
      onAirflowChange(newValue);
      audioManager.updateFurnaceSound(newValue, furnaceStateRef.current.temperature);
    }
  }, [isDraggingBellows, bellowsDragStart, onAirflowChange]);

  const handleMouseUp = useCallback(() => {
    handleIngredientDrop();
    setIsDraggingBellows(false);
  }, [handleIngredientDrop]);

  const handleBellowsMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    audioManager.resume();
    audioManager.playClickSound();
    setIsDraggingBellows(true);
    setBellowsDragStart({
      x: e.clientX - (containerRef.current?.getBoundingClientRect().left || 0),
      value: airflow
    });
  }, [airflow]);

  const handleJadeBoxClick = useCallback(() => {
    if (!jadeBoxOpen) {
      audioManager.playClickSound();
    }
    setJadeBoxOpen(!jadeBoxOpen);
    setCaughtPill(null);
  }, [jadeBoxOpen]);

  useEffect(() => {
    const state = furnaceStateRef.current;
    state.airFlow = airflow;
    state.flameHeight = calculateFlameHeight(80, airflow, state.currentElements);
    audioManager.updateFurnaceSound(airflow, state.temperature);
  }, [airflow]);

  useEffect(() => {
    audioManager.init();
    lastTimeRef.current = performance.now();
    lastLandscapeTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      audioManager.stopFurnaceSound();
    };
  }, [render]);

  return (
    <div 
      ref={containerRef}
      style={styles.container}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        style={styles.canvas}
      />
      
      <div style={styles.airflowGauge}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle
            cx="40"
            cy="40"
            r="32"
            fill="none"
            stroke="rgba(107, 76, 58, 0.5)"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r="32"
            fill="none"
            stroke="#d4ac0d"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(airflow / 100) * 201} 201`}
            transform="rotate(-90 40 40)"
            style={{ filter: 'drop-shadow(0 0 4px rgba(212, 172, 13, 0.5))' }}
          />
          <text
            x="40"
            y="38"
            textAnchor="middle"
            fill="#d4ac0d"
            fontSize="20"
            fontFamily="'Ma Shan Zheng', cursive"
          >
            {Math.round(airflow)}
          </text>
          <text
            x="40"
            y="54"
            textAnchor="middle"
            fill="#8b7355"
            fontSize="10"
            fontFamily="'ZCOOL KuaiLe', cursive"
          >
            风量
          </text>
        </svg>
      </div>
      
      <div
        style={{
          ...styles.jadeBoxOverlay,
          left: jadeBoxPos.x,
          top: jadeBoxPos.y,
          width: JADE_BOX_WIDTH,
          height: JADE_BOX_HEIGHT
        }}
        onClick={handleJadeBoxClick}
      />
      
      <div
        style={styles.bellowsHandle}
        onMouseDown={handleBellowsMouseDown}
      />
      
      {caughtPill && (
        <div style={styles.pillNotification}>
          <div style={{ ...styles.pillIcon, backgroundColor: caughtPill.color }} />
          <span style={styles.pillName}>{caughtPill.name}</span>
          <span style={styles.pillRarity}>(已收入玉盒)</span>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  canvas: {
    width: '100%',
    height: '100%',
    maxWidth: '900px',
    maxHeight: '650px',
    cursor: 'default'
  },
  airflowGauge: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'rgba(42, 26, 14, 0.9)',
    borderRadius: '12px',
    padding: '10px',
    border: '2px solid #6b4c3a',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
  },
  jadeBoxOverlay: {
    position: 'absolute',
    cursor: 'pointer',
    zIndex: 5
  },
  bellowsHandle: {
    position: 'absolute',
    left: 'calc(50% - 300px)',
    top: 'calc(50% - 30px)',
    width: '60px',
    height: '60px',
    cursor: 'grab',
    zIndex: 5
  },
  pillNotification: {
    position: 'absolute',
    bottom: '30px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(42, 26, 14, 0.95)',
    border: '2px solid #d4ac0d',
    borderRadius: '8px',
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    zIndex: 20
  },
  pillIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    boxShadow: '0 0 10px currentColor'
  },
  pillName: {
    fontFamily: "'Ma Shan Zheng', cursive",
    fontSize: '18px',
    color: '#d4ac0d'
  },
  pillRarity: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '12px',
    color: '#8b7355'
  }
};

export default Furnace;
