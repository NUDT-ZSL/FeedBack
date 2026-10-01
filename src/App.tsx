import React, { useState, useEffect, useCallback } from 'react';
import SimulationCanvas from './SimulationCanvas';
import ControlPanel from './ControlPanel';

const DEFAULT_BALL_COUNT = 5;
const DEFAULT_MASS = 1;
const DEFAULT_DAMPING = 0.005;

function createDefaultMasses(count: number): number[] {
  return Array(count).fill(DEFAULT_MASS);
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  progress: number;
}

const App: React.FC = () => {
  const [ballCount, setBallCount] = useState<number>(DEFAULT_BALL_COUNT);
  const [masses, setMasses] = useState<number[]>(createDefaultMasses(DEFAULT_BALL_COUNT));
  const [damping, setDamping] = useState<number>(DEFAULT_DAMPING);
  const [paused, setPaused] = useState<boolean>(false);
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [, setPhysicsData] = useState({ momentum: 0, energy: 0 });
  const [isNarrow, setIsNarrow] = useState<boolean>(false);
  const [rippleIdCounter, setRippleIdCounter] = useState<number>(0);

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth < 900);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const handleBallCountChange = useCallback((n: number) => {
    setBallCount(n);
    setMasses((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(DEFAULT_MASS);
      return next;
    });
  }, []);

  const handleMassChange = useCallback((index: number, value: number) => {
    setMasses((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleTogglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      if (prev) {
        const id = Date.now();
        setRippleIdCounter(id);
        setRipples((r) => [
          ...r,
          { id, x: window.innerWidth * 0.35, y: 300, progress: 0 },
        ]);
      }
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setResetTrigger((t) => t + 1);
    setPaused(false);
  }, []);

  const handlePhysicsUpdate = useCallback((momentum: number, energy: number) => {
    setPhysicsData({ momentum, energy });
  }, []);

  const handleRippleComplete = useCallback((id: number) => {
    setRipples((r) => r.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    if (ripples.length === 0) return;
    let frame: number;
    const start = performance.now();
    const duration = 300;

    const animate = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      setRipples((prev) =>
        prev.map((r) => ({ ...r, progress: t }))
      );
      if (t < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        const ids = ripples.map((r) => r.id);
        ids.forEach((id) => handleRippleComplete(id));
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [rippleIdCounter, handleRippleComplete]);

  const handleExport = useCallback(() => {
    if (exporting) return;
    setExporting(true);
    setExportProgress(0);

    const startTime = performance.now();
    const duration = 2000;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(100, (elapsed / duration) * 100);
      setExportProgress(progress);

      if (progress < 100) {
        requestAnimationFrame(animate);
      } else {
        setTimeout(() => {
          setExporting(false);
          setExportProgress(0);
          triggerDownload();
        }, 200);
      }
    };
    requestAnimationFrame(animate);
  }, [exporting, ballCount, masses, damping]);

  const triggerDownload = useCallback(() => {
    const avgMass = masses.length > 0
      ? (masses.reduce((a, b) => a + b, 0) / masses.length).toFixed(1)
      : '1';
    const fileName = `牛顿摆_${ballCount}球_质量${avgMass}_阻力${damping.toFixed(3)}.gif`;

    const width = 400;
    const height = 300;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, width, height);

    const pivotY = 60;
    const ropeLen = 150;
    const spacing = 32;
    const totalW = (ballCount - 1) * spacing;
    const startX = width / 2 - totalW / 2;

    for (let i = 0; i < ballCount; i++) {
      const mass = masses[i] || 1;
      const radius = 12 + mass * 3;
      const px = startX + i * spacing;
      const phase = Math.sin((Date.now() / 500) + i * 0.5) * 0.3;
      const bx = px + Math.sin(phase) * ropeLen;
      const by = pivotY + Math.cos(phase) * ropeLen;

      ctx.beginPath();
      ctx.moveTo(px, pivotY);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.stroke();

      const t = (mass - 0.5) / 4.5;
      const r = Math.round(79 + (255 - 79) * t);
      const g = Math.round(195 + (112 - 195) * t);
      const b = Math.round(247 + (67 - 247) * t);

      const grad = ctx.createRadialGradient(bx - radius * 0.3, by - radius * 0.3, 1, bx, by, radius);
      grad.addColorStop(0, `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`);
      grad.addColorStop(1, `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`);
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.fillStyle = '#37474f';
    ctx.fillRect(startX - 10, pivotY - 8, totalW + 20, 5);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }, [ballCount, masses, damping]);

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: isNarrow ? 'column' : 'row',
    gap: '20px',
    padding: '20px',
    boxSizing: 'border-box',
    alignItems: isNarrow ? 'stretch' : 'flex-start',
    justifyContent: 'center',
  };

  const canvasContainerStyle: React.CSSProperties = {
    flex: isNarrow ? 'none' : '1',
    width: isNarrow ? '100%' : '70%',
    minHeight: '600px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    display: 'flex',
  };

  const panelWrapperStyle: React.CSSProperties = {
    width: isNarrow ? '100%' : 'auto',
    display: 'flex',
    justifyContent: 'center',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      <div style={canvasContainerStyle}>
        <SimulationCanvas
          ballCount={ballCount}
          masses={masses}
          damping={damping}
          paused={paused}
          onTogglePause={handleTogglePause}
          resetTrigger={resetTrigger}
          onPhysicsUpdate={handlePhysicsUpdate}
          ripples={ripples}
          onRippleComplete={handleRippleComplete}
        />
      </div>
      <div style={panelWrapperStyle}>
        <ControlPanel
          ballCount={ballCount}
          setBallCount={handleBallCountChange}
          masses={masses}
          setMass={handleMassChange}
          damping={damping}
          setDamping={setDamping}
          paused={paused}
          onTogglePause={handleTogglePause}
          onReset={handleReset}
          exporting={exporting}
          exportProgress={exportProgress}
          onExport={handleExport}
        />
      </div>
    </div>
  );
};

export default App;
