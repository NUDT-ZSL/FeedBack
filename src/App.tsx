import { useCallback, useEffect, useRef, useState } from 'react';
import { Scene } from './components/Scene.tsx';
import {
  AnglesPanel,
  OcclusionPanel,
  PredictionPanel,
  RingSelectPanel,
  Timeline,
  VerifyPanel,
  exportStarChart
} from './components/Panels.tsx';
import { useSimulation } from './useSimulation.ts';
import { DEFAULT_RING_ORIENTATION, RING_KEYS, type RingKey } from './engine/index.ts';
import { TIMELINE } from './types.ts';

export default function App() {
  const sim = useSimulation();
  const [tilts, setTilts] = useState<Record<RingKey, number>>(() => {
    const init = {} as Record<RingKey, number>;
    for (const key of RING_KEYS) init[key] = DEFAULT_RING_ORIENTATION[key].inclination;
    return init;
  });
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const rafRef = useRef(0);
  const lastTs = useRef(0);

  useEffect(() => {
    if (!playing) return;
    lastTs.current = performance.now();
    const tick = (ts: number) => {
      const dt = ts - lastTs.current;
      lastTs.current = ts;
      sim.setTime((t) => {
        const next = t + dt;
        return next > TIMELINE.end ? TIMELINE.start : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, sim]);

  const handleTiltChange = useCallback(
    (patch: Partial<Record<RingKey, number>>) => {
      setTilts((prev) => {
        const next = { ...prev, ...patch };
        sim.setRingTilt(next);
        return next;
      });
    },
    [sim]
  );

  const handleBodyPick = useCallback(
    (id: string) => {
      setPicked(id);
      sim.correctBody(id);
    },
    [sim]
  );

  return (
    <div className="app">
      <div className="scene-wrap">
        <Scene
          frame={sim.frame}
          tilts={tilts}
          onTiltChange={handleTiltChange}
          onCentralClick={sim.addPlanet}
          onBodyPick={handleBodyPick}
        />
        <Timeline
          time={sim.time}
          onChange={sim.setTime}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
        />
        {picked && (
          <div className="toast">已修正 {picked} 的轨道参数（自当前时刻生效，增量重推）</div>
        )}
      </div>
      <aside className="sidebar">
        <h1>浑天仪星盘推演</h1>
        <PredictionPanel notes={sim.notes} />
        <OcclusionPanel frame={sim.frame} />
        <AnglesPanel frame={sim.frame} />
        <RingSelectPanel selected={sim.selectedRing} onSelect={sim.setSelectedRing} />
        <VerifyPanel onExport={() => void exportStarChart()} />
      </aside>
    </div>
  );
}
