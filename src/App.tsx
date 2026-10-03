import React, { useState, useEffect, useCallback } from 'react';
import SimulationCanvas from './SimulationCanvas';
import ControlPanel from './ControlPanel';
import SnapshotPanel, { SnapshotNotice } from './SnapshotPanel';
import {
  Snapshot,
  SnapshotParams,
  BASELINE_SNAPSHOT_ID,
  DEFAULT_BALL_COUNT,
  DEFAULT_MASS,
  DEFAULT_DAMPING,
  buildSnapshot,
  clampBallCount,
  clampDamping,
  createDefaultParams,
  loadSnapshots,
  normalizeMasses,
  paramsEqual,
  parseSnapshotFile,
  saveSnapshots,
  serializeSnapshots,
} from './SnapshotManager';

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
  const [snapshots, setSnapshots] = useState<Snapshot[]>(loadSnapshots);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    BASELINE_SNAPSHOT_ID
  );
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);

  useEffect(() => {
    saveSnapshots(snapshots);
  }, [snapshots]);

  useEffect(() => {
    if (!snapshotNotice) return;
    const timer = window.setTimeout(() => setSnapshotNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [snapshotNotice]);

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

  const currentParams: SnapshotParams = { ballCount, masses, damping };
  const selectedSnapshot =
    snapshots.find((s) => s.id === selectedSnapshotId) ?? null;
  const deviated = selectedSnapshot
    ? !paramsEqual(selectedSnapshot, currentParams)
    : false;

  const applyParams = useCallback((params: SnapshotParams) => {
    const count = clampBallCount(params.ballCount);
    setBallCount(count);
    setMasses(normalizeMasses(params.masses, count));
    setDamping(clampDamping(params.damping));
    setResetTrigger((t) => t + 1);
    setPaused(false);
  }, []);

  const handleSaveSnapshot = useCallback(
    (rawName: string) => {
      const snapshot = buildSnapshot(rawName, { ballCount, masses, damping });
      setSnapshots((prev) => [
        prev.find((s) => s.isBaseline)!,
        snapshot,
        ...prev.filter((s) => !s.isBaseline),
      ]);
      setSelectedSnapshotId(snapshot.id);
      setSnapshotNotice({
        type: 'success',
        text: `已保存快照「${snapshot.name}」，参数（${snapshot.ballCount} 球 / 阻力 ${snapshot.damping.toFixed(3)}）。`,
      });
    },
    [ballCount, masses, damping]
  );

  const handleSelectSnapshot = useCallback(
    (id: string) => {
      const target = snapshots.find((s) => s.id === id);
      if (!target) return;
      setSelectedSnapshotId(target.id);
      applyParams(target);
    },
    [snapshots, applyParams]
  );

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      const target = snapshots.find((s) => s.id === id);
      if (!target || target.isBaseline) return;
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
      if (id === selectedSnapshotId) {
        applyParams(createDefaultParams());
        setSelectedSnapshotId(BASELINE_SNAPSHOT_ID);
      }
      setSnapshotNotice({
        type: 'success',
        text:
          id === selectedSnapshotId
            ? `已删除快照「${target.name}」，参数已恢复为基准默认值。`
            : `已删除快照「${target.name}」。`,
      });
    },
    [snapshots, selectedSnapshotId, applyParams]
  );

  const handleExportSnapshots = useCallback(() => {
    const userSnapshots = snapshots.filter((s) => !s.isBaseline);
    if (userSnapshots.length === 0) {
      setSnapshotNotice({
        type: 'error',
        text: '当前没有可导出的自定义快照（基准快照不导出）。',
      });
      return;
    }
    const text = serializeSnapshots(snapshots);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `牛顿摆参数快照_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSnapshotNotice({
      type: 'success',
      text: `已导出 ${userSnapshots.length} 个快照到 JSON 文件，可离线保存。`,
    });
  }, [snapshots]);

  const handleImportSnapshotFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const result = parseSnapshotFile(text);
      if (result.snapshots.length === 0) {
        setSnapshotNotice({
          type: 'error',
          text: ['导入失败，已有快照保持不变：', ...result.errors].join('\n'),
        });
        return;
      }
      setSnapshots((prev) => [
        prev.find((s) => s.isBaseline)!,
        ...result.snapshots,
        ...prev.filter((s) => !s.isBaseline),
      ]);
      const lines = [
        `成功导入 ${result.snapshots.length} 个快照，已有快照保持不变。`,
      ];
      if (result.warnings.length > 0) lines.push(...result.warnings);
      if (result.errors.length > 0) {
        lines.push(
          `跳过 ${result.errors.length} 条无效记录：`,
          ...result.errors
        );
      }
      setSnapshotNotice({
        type: result.errors.length > 0 ? 'error' : 'success',
        text: lines.join('\n'),
      });
    };
    reader.onerror = () => {
      setSnapshotNotice({
        type: 'error',
        text: '读取文件失败，已有快照保持不变。',
      });
    };
    reader.readAsText(file);
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
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
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
        <SnapshotPanel
          snapshots={snapshots}
          selectedSnapshotId={selectedSnapshotId}
          deviated={deviated}
          notice={snapshotNotice}
          onSave={handleSaveSnapshot}
          onSelect={handleSelectSnapshot}
          onDelete={handleDeleteSnapshot}
          onExport={handleExportSnapshots}
          onImportFile={handleImportSnapshotFile}
        />
      </div>
    </div>
  );
};

export default App;
