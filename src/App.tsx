import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeductionEngine,
  snapshotsEqual,
  type OrbitalParams,
  type RingConfig,
  type RingType
} from './engine';
import { PREDICTIONS, RING_COLORS } from './types';
import Scene from './components/Scene';
import Panel from './components/Panel';

const DEFAULT_RINGS: RingConfig[] = [
  { type: 'ecliptic', radius: 5.6, inclinationDeg: 23.5, nodeAngleDeg: 0 },
  { type: 'equator', radius: 5.2, inclinationDeg: 0, nodeAngleDeg: 0 },
  { type: 'galactic', radius: 6.0, inclinationDeg: 60, nodeAngleDeg: 30 }
];

const DEFAULT_OBSERVER: [number, number, number] = [0, 4, 14];
const TIME_STEP = 0.05;
const OCCLUSION_THRESHOLD_DEG = 2;
const TIME_RANGE = 600;

const RING_LABELS: Record<RingType, string> = {
  ecliptic: '黄道',
  equator: '赤道',
  galactic: '银道'
};

export default function App() {
  const engineRef = useRef<DeductionEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new DeductionEngine({
      rings: DEFAULT_RINGS,
      observer: { position: DEFAULT_OBSERVER },
      occlusionThresholdDeg: OCCLUSION_THRESHOLD_DEG,
      timeStep: TIME_STEP
    });
  }
  const engine = engineRef.current;

  const [rings, setRings] = useState<RingConfig[]>(DEFAULT_RINGS);
  const [bodies, setBodies] = useState<OrbitalParams[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedRing, setSelectedRing] = useState<RingType>('ecliptic');
  const [version, setVersion] = useState(0);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const nextId = useRef(1);
  const predictions = useRef(new Map<number, string>());
  const observerRef = useRef<[number, number, number]>(DEFAULT_OBSERVER);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // 渲染层唯一的数据来源：向推演引擎索取当前时刻的快照，自己不算任何角度
  const snapshot = useMemo(
    () => engine.getSnapshot(time),
    [engine, time, version]
  );
  const stats = useMemo(() => engine.getStats(), [engine, time, version]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => t + dt * speed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const addPlanet = useCallback(
    (ring: RingType) => {
      const id = nextId.current;
      nextId.current += 1;
      const params: OrbitalParams = {
        bodyId: id,
        ring,
        baseAngleDeg: Math.random() * 360,
        angularVelocityDegPerSec:
          (5 + Math.random() * 25) * (Math.random() < 0.5 ? -1 : 1),
        radialOffset: 0
      };
      engine.addBody(params);
      predictions.current.set(id, PREDICTIONS[id % PREDICTIONS.length]);
      setBodies((list) => [...list, params]);
      bump();
    },
    [engine, bump]
  );

  const removeBody = useCallback(
    (bodyId: number) => {
      engine.removeBody(bodyId);
      predictions.current.delete(bodyId);
      setBodies((list) => list.filter((b) => b.bodyId !== bodyId));
      bump();
    },
    [engine, bump]
  );

  // 修正单个星体的轨道参数：引擎只重推该星体，其余星体与时刻复用缓存
  const fixOrbit = useCallback(
    (bodyId: number) => {
      const current = bodies.find((b) => b.bodyId === bodyId);
      if (!current) {
        return;
      }
      const delta = Math.random() * 20 - 10;
      engine.updateOrbitalParams(bodyId, {
        baseAngleDeg: current.baseAngleDeg + delta
      });
      setBodies((list) =>
        list.map((b) =>
          b.bodyId === bodyId ? { ...b, baseAngleDeg: b.baseAngleDeg + delta } : b
        )
      );
      bump();
    },
    [engine, bodies, bump]
  );

  const handleRingInclination = useCallback(
    (type: RingType, inclinationDeg: number) => {
      engine.setRingConfig(type, { inclinationDeg });
      setRings((list) =>
        list.map((r) => (r.type === type ? { ...r, inclinationDeg } : r))
      );
      bump();
    },
    [engine, bump]
  );

  const handleCameraChange = useCallback(
    (position: [number, number, number]) => {
      const rounded: [number, number, number] = [
        Math.round(position[0] * 10) / 10,
        Math.round(position[1] * 10) / 10,
        Math.round(position[2] * 10) / 10
      ];
      const prev = observerRef.current;
      if (
        rounded[0] === prev[0] &&
        rounded[1] === prev[1] &&
        rounded[2] === prev[2]
      ) {
        return;
      }
      observerRef.current = rounded;
      engine.setObserver({ position: rounded });
      bump();
    },
    [engine, bump]
  );

  // 脱离渲染层的一致性核对：当前引擎（含缓存）与全新引擎整体重推逐刻比对
  const runVerify = useCallback(() => {
    const fresh = new DeductionEngine({
      rings,
      observer: { position: observerRef.current },
      occlusionThresholdDeg: OCCLUSION_THRESHOLD_DEG,
      timeStep: TIME_STEP
    });
    fresh.setBodies(bodies);
    const t0 = time - 30;
    const t1 = time + 30;
    const cachedRun = engine.batchDeduce(t0, t1, 0.5);
    const freshRun = fresh.batchDeduce(t0, t1, 0.5);
    const consistent =
      cachedRun.length === freshRun.length &&
      cachedRun.every((s, i) => snapshotsEqual(s, freshRun[i]));
    setVerifyResult(
      consistent
        ? `✓ 区间 [${t0.toFixed(1)}s, ${t1.toFixed(1)}s] 共 ${cachedRun.length} 个时刻，缓存推演与整体重推完全一致`
        : `✗ 区间 [${t0.toFixed(1)}s, ${t1.toFixed(1)}s] 存在不一致时刻`
    );
  }, [engine, rings, bodies, time]);

  return (
    <div className="app">
      <Scene
        rings={rings}
        snapshot={snapshot}
        onRingInclination={handleRingInclination}
        onMainStarClick={() => addPlanet(selectedRing)}
        onCameraChange={handleCameraChange}
      />
      <Panel
        snapshot={snapshot}
        predictions={predictions.current}
        stats={stats}
        verifyResult={verifyResult}
        onRunVerify={runVerify}
        onFixOrbit={fixOrbit}
        onRemoveBody={removeBody}
      />
      <div className="timeline">
        <div className="timeline-row">
          <button className="ctrl-btn" onClick={() => setPlaying((p) => !p)}>
            {playing ? '⏸ 暂停' : '▶ 推演'}
          </button>
          <select
            className="ctrl-select"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
          <input
            className="timeline-slider"
            type="range"
            min={-TIME_RANGE}
            max={TIME_RANGE}
            step={TIME_STEP}
            value={Math.min(TIME_RANGE, Math.max(-TIME_RANGE, time))}
            onChange={(e) => setTime(Number(e.target.value))}
          />
          <span className="time-label">t = {time.toFixed(2)}s</span>
          <button className="ctrl-btn" onClick={() => setTime(0)}>
            归零
          </button>
        </div>
        <div className="timeline-row ring-picker">
          {(Object.keys(RING_LABELS) as RingType[]).map((type) => (
            <button
              key={type}
              className={`ring-btn${selectedRing === type ? ' active' : ''}`}
              style={{ borderColor: RING_COLORS[type], color: RING_COLORS[type] }}
              onClick={() => setSelectedRing(type)}
            >
              {RING_LABELS[type]}环
            </button>
          ))}
          <span className="hint">点击主星，在当前星环上标记行星</span>
        </div>
      </div>
    </div>
  );
}
