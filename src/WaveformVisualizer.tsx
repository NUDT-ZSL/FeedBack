import React, { useRef, useEffect, useCallback, useState } from 'react';
import { MIN_SELECTION_DURATION, type Selection } from './AudioEngine';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  onSeek: (time: number) => void;
  getWaveformData: (samples: number) => Float32Array;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startTime: number;
  isSelecting: boolean;
  edge: 'start' | 'end' | null;
  fixedEdgeTime: number;
}

const EDGE_HIT_PX = 8;

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  audioBuffer,
  currentTime,
  duration,
  selection,
  onSelectionChange,
  onSeek,
  getWaveformData
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const waveformDataRef = useRef<Float32Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startTime: 0,
    isSelecting: false,
    edge: null,
    fixedEdgeTime: 0
  });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<'start' | 'end' | null>(null);

  const getEdgeAtX = useCallback((clientX: number): 'start' | 'end' | null => {
    const container = containerRef.current;
    if (!container || !selection || duration === 0) return null;

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const startX = (selection.start / duration) * rect.width;
    const endX = (selection.end / duration) * rect.width;

    if (Math.abs(x - startX) <= EDGE_HIT_PX) return 'start';
    if (Math.abs(x - endX) <= EDGE_HIT_PX) return 'end';
    return null;
  }, [selection, duration]);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    if (audioBuffer) {
      const samples = Math.floor(rect.width * 2);
      waveformDataRef.current = getWaveformData(samples);
    }
  }, [audioBuffer, getWaveformData]);

  const getTimeFromX = useCallback((x: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return 0;
    
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !container) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    if (!waveformDataRef.current || waveformDataRef.current.length === 0) {
      return;
    }

    const waveformData = waveformDataRef.current;
    const barCount = waveformData.length;
    const barWidth = width / barCount;
    const maxBarHeight = height * 0.4;

    if (selection) {
      const selStartX = (selection.start / duration) * width;
      const selEndX = (selection.end / duration) * width;
      const selWidth = selEndX - selStartX;
      
      ctx.fillStyle = 'rgba(0, 212, 255, 0.15)';
      ctx.fillRect(selStartX, 0, selWidth, height);
      
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(selStartX, 0);
      ctx.lineTo(selStartX, height);
      ctx.moveTo(selEndX, 0);
      ctx.lineTo(selEndX, height);
      ctx.stroke();

      const handleWidth = 6;
      const handleHeight = Math.min(28, height * 0.35);
      ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
      ctx.shadowColor = 'rgba(0, 212, 255, 0.8)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.roundRect(selStartX - handleWidth / 2, centerY - handleHeight / 2, handleWidth, handleHeight, 3);
      ctx.roundRect(selEndX - handleWidth / 2, centerY - handleHeight / 2, handleWidth, handleHeight, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#00d4ff');
    gradient.addColorStop(0.5, '#8b5cf6');
    gradient.addColorStop(1, '#ec4899');

    ctx.shadowColor = 'rgba(0, 212, 255, 0.5)';
    ctx.shadowBlur = 10;

    for (let i = 0; i < barCount; i++) {
      const barHeight = waveformData[i] * maxBarHeight;
      const x = i * barWidth;
      
      const progressRatio = currentTime / duration;
      const barProgress = i / barCount;
      
      if (barProgress <= progressRatio) {
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.globalAlpha = 0.5;
      }

      const w = Math.max(1, barWidth - 1);
      const h = Math.max(1, barHeight);
      
      ctx.fillRect(x, centerY - h, w, h);
      ctx.fillRect(x, centerY, w, h);
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    const progressX = (currentTime / duration) * width;
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(progressX, centerY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 15;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (hoverTime !== null && dragStateRef.current.isDragging) {
      const hoverProgressX = (hoverTime / duration) * width;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hoverProgressX, 0);
      ctx.lineTo(hoverProgressX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [currentTime, duration, selection, hoverTime]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0) return;
    
    e.preventDefault();
    const time = getTimeFromX(e.clientX);
    
    if (e.shiftKey) {
      dragStateRef.current = {
        isDragging: true,
        startX: e.clientX,
        startTime: time,
        isSelecting: true,
        edge: null,
        fixedEdgeTime: 0
      };
      onSelectionChange({ start: time, end: time });
      return;
    }

    const edge = getEdgeAtX(e.clientX);
    if (edge && selection) {
      dragStateRef.current = {
        isDragging: true,
        startX: e.clientX,
        startTime: time,
        isSelecting: false,
        edge,
        fixedEdgeTime: edge === 'start' ? selection.end : selection.start
      };
      return;
    }

    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startTime: time,
      isSelecting: false,
      edge: null,
      fixedEdgeTime: 0
    };
    onSeek(time);
  }, [duration, getTimeFromX, getEdgeAtX, selection, onSeek, onSelectionChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const time = getTimeFromX(e.clientX);
    setHoverTime(time);

    if (!dragStateRef.current.isDragging) {
      setHoverEdge(getEdgeAtX(e.clientX));
    }

    if (!dragStateRef.current.isDragging || duration === 0) return;

    const edge = dragStateRef.current.edge;
    if (edge) {
      const fixed = dragStateRef.current.fixedEdgeTime;
      if (edge === 'start') {
        const newStart = Math.max(0, Math.min(time, fixed - MIN_SELECTION_DURATION));
        onSelectionChange({ start: newStart, end: fixed });
      } else {
        const newEnd = Math.min(duration, Math.max(time, fixed + MIN_SELECTION_DURATION));
        onSelectionChange({ start: fixed, end: newEnd });
      }
    } else if (dragStateRef.current.isSelecting) {
      const startTime = dragStateRef.current.startTime;
      const newSelection = {
        start: Math.min(startTime, time),
        end: Math.max(startTime, time)
      };
      onSelectionChange(newSelection);
    } else {
      onSeek(time);
    }
  }, [duration, getTimeFromX, getEdgeAtX, onSeek, onSelectionChange]);

  const handleMouseUp = useCallback(() => {
    dragStateRef.current.isDragging = false;
    dragStateRef.current.isSelecting = false;
    dragStateRef.current.edge = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
    setHoverEdge(null);
    if (dragStateRef.current.isDragging) {
      dragStateRef.current.isDragging = false;
      dragStateRef.current.isSelecting = false;
      dragStateRef.current.edge = null;
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    onSelectionChange(null);
  }, [onSelectionChange]);

  useEffect(() => {
    setupCanvas();
    
    const handleResize = () => {
      setupCanvas();
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvas]);

  useEffect(() => {
    if (audioBuffer) {
      setupCanvas();
    }
  }, [audioBuffer, setupCanvas]);

  useEffect(() => {
    const animate = () => {
      draw();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  return (
    <div 
      ref={containerRef}
      className="waveform-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
      style={{
        cursor: duration === 0
          ? 'default'
          : (hoverEdge || dragStateRef.current.edge)
            ? 'ew-resize'
            : 'crosshair'
      }}
    >
      <canvas ref={canvasRef} />
      {selection && (
        <div className="selection-time">
          选区: {formatTime(selection.start)} - {formatTime(selection.end)}
        </div>
      )}
    </div>
  );
};

export default WaveformVisualizer;
