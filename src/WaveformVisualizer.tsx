import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Selection } from './AudioEngine';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  onSeek: (time: number) => void;
  getWaveformData: (samples: number) => Float32Array;
}

type DragMode = 'select' | 'seek' | 'edge-start' | 'edge-end';

interface DragState {
  isDragging: boolean;
  mode: DragMode | null;
  anchorTime: number;
}

const EDGE_THRESHOLD_PX = 8;

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
    mode: null,
    anchorTime: 0
  });
  const edgeSelectionRef = useRef<Selection | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [isNearEdge, setIsNearEdge] = useState(false);

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

  const getEdgeAtX = useCallback((clientX: number): 'start' | 'end' | null => {
    if (!selection) return null;
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + (selection.start / duration) * rect.width;
    const endX = rect.left + (selection.end / duration) * rect.width;
    const distStart = Math.abs(clientX - startX);
    const distEnd = Math.abs(clientX - endX);

    if (distStart <= EDGE_THRESHOLD_PX || distEnd <= EDGE_THRESHOLD_PX) {
      return distStart <= distEnd ? 'start' : 'end';
    }
    return null;
  }, [selection, duration]);

  const handleDragMove = useCallback((clientX: number) => {
    const drag = dragStateRef.current;
    if (!drag.isDragging || !drag.mode || duration === 0) return;

    const time = getTimeFromX(clientX);

    if (drag.mode === 'select') {
      onSelectionChange({
        start: Math.min(drag.anchorTime, time),
        end: Math.max(drag.anchorTime, time)
      });
    } else if (drag.mode === 'seek') {
      onSeek(time);
    } else {
      const current = edgeSelectionRef.current;
      if (!current) return;
      const next = { ...current };
      if (drag.mode === 'edge-start') {
        next.start = time;
      } else {
        next.end = time;
      }
      edgeSelectionRef.current = next;
      onSelectionChange(next);
      onSeek(time);
    }
  }, [duration, getTimeFromX, onSeek, onSelectionChange]);

  const endDrag = useCallback(() => {
    dragStateRef.current.isDragging = false;
    dragStateRef.current.mode = null;
    edgeSelectionRef.current = null;
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
  }, []);

  const beginDrag = useCallback((mode: DragMode, time: number) => {
    dragStateRef.current = { isDragging: true, mode, anchorTime: time };

    const onWindowMove = (ev: MouseEvent) => handleDragMove(ev.clientX);
    const onWindowUp = () => endDrag();

    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);

    dragCleanupRef.current = () => {
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };
  }, [handleDragMove, endDrag]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0) return;

    e.preventDefault();
    const time = getTimeFromX(e.clientX);

    if (e.shiftKey) {
      beginDrag('select', time);
      onSelectionChange({ start: time, end: time });
      return;
    }

    const edge = getEdgeAtX(e.clientX);
    if (edge && selection) {
      edgeSelectionRef.current = { ...selection };
      beginDrag(edge === 'start' ? 'edge-start' : 'edge-end', time);
      return;
    }

    beginDrag('seek', time);
    onSeek(time);
  }, [duration, getTimeFromX, getEdgeAtX, selection, beginDrag, onSeek, onSelectionChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const time = getTimeFromX(e.clientX);
    setHoverTime(time);

    if (!dragStateRef.current.isDragging) {
      setIsNearEdge(getEdgeAtX(e.clientX) !== null);
    }
  }, [getTimeFromX, getEdgeAtX]);

  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
    setIsNearEdge(false);
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

  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className="waveform-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: duration > 0 ? (isNearEdge ? 'ew-resize' : 'crosshair') : 'default' }}
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
