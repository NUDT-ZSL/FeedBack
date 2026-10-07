// 渲染层与推演引擎的唯一连接点：
// 渲染层只调用本 Hook 获取 SimulationFrame，不自行计算任何角度/遮挡。
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  SimulationEngine,
  generateBodies,
  type RingTiltSet
} from './engine/index.ts';
import { OBSERVER } from './engine/verify.ts';
import {
  DEFAULT_CONFIG,
  PREDICTIONS,
  RING_COLORS,
  type OrbitalBodyParams,
  type RingKey,
  type SimulationFrame
} from './types.ts';

export interface PlanetNote {
  bodyId: string;
  prediction: string;
  createdAt: number;
}

const INITIAL_BODY_COUNT = 15;

export function useSimulation() {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SimulationEngine(generateBodies(INITIAL_BODY_COUNT), OBSERVER, {
      ...DEFAULT_CONFIG
    });
  }
  const engine = engineRef.current;

  const [time, setTime] = useState(0);
  // 引擎内部状态（参数修正 / 倾角 / 新增星体）变化时递增，触发帧重取
  const [epoch, setEpoch] = useState(0);
  const [notes, setNotes] = useState<PlanetNote[]>([]);
  const [selectedRing, setSelectedRing] = useState<RingKey>('ecliptic');
  const planetSeq = useRef(0);

  const frame: SimulationFrame = useMemo(
    () => engine.getFrame(time),
    // epoch 变化时引擎缓存已失效，getFrame 返回新帧
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, time, epoch]
  );

  const setRingTilt = useCallback(
    (tilt: RingTiltSet) => {
      engine.setRingTilt(tilt);
      setEpoch((e) => e + 1);
    },
    [engine]
  );

  /** 点击主星：在选定环带上确定性生成一颗新行星（参数完全由序号推导，无随机） */
  const addPlanet = useCallback(() => {
    const seq = planetSeq.current++;
    const id = `planet-${String(seq).padStart(3, '0')}`;
    const body: OrbitalBodyParams = {
      id,
      name: `客星·${seq + 1}`,
      homeRing: selectedRing,
      radius: 3.4 + (seq % 5) * 0.3,
      phase0: (seq * 47 + 15) % 360,
      period: 30000 + (seq % 7) * 9000,
      inclination: (seq % 3) * 1.5,
      azimuth: (seq * 61) % 360,
      depthOrder: 1000 + seq,
      magnitude: 1 + (seq % 4),
      color: RING_COLORS[selectedRing],
      revision: 0
    };
    engine.addBody(body, engine.quantize(time));
    setNotes((prev) => [
      ...prev,
      { bodyId: id, prediction: PREDICTIONS[seq % PREDICTIONS.length], createdAt: engine.quantize(time) }
    ]);
    setEpoch((e) => e + 1);
    return id;
  }, [engine, selectedRing, time]);

  /** 修正某颗星体的轨道参数（演示增量重推） */
  const correctBody = useCallback(
    (bodyId: string) => {
      const body = engine.getBodies().find((b) => b.id === bodyId);
      if (!body) return;
      engine.updateBody({
        id: bodyId,
        patch: { period: body.period * 0.85, inclination: body.inclination + 3 },
        effectiveFrom: engine.quantize(time)
      });
      setEpoch((e) => e + 1);
    },
    [engine, time]
  );

  return {
    engine,
    frame,
    time,
    setTime,
    notes,
    selectedRing,
    setSelectedRing,
    setRingTilt,
    addPlanet,
    correctBody
  };
}
