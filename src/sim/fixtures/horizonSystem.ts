/**
 * 地平线遮挡专用样例：
 * 观测站纬度 45°N，1 tick = 1 恒星时（LST 推进 15°/tick）。
 * - equator_east：天赤道恒星（赤纬0°），高度角 h 满足 sin h = cos45°·cos(HA)，
 *   t=6 / t=18 时恰在地平线临界（h=0）；
 * - circumpolar：赤纬 +60°，在 45°N 为拱极星，最低高度 15°，永不落；
 * - never_rise：赤纬 -60°，在 45°N 最高高度 -15°，永不升。
 */

import { SimulationConfig } from '../types';

export const horizonSystem: SimulationConfig = {
  observer: {
    latitudeDeg: 45,
    lstAtEpochDeg: 0,
    lstRateDegPerTick: 15,
    epochTick: 0,
  },
  bodies: [
    {
      kind: 'fixed',
      id: 'equator_east',
      name: '赤道东星',
      physicalRadius: 0.01,
      raAtEpochDeg: 0,
      decDeg: 0,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 100,
    },
    {
      kind: 'fixed',
      id: 'circumpolar',
      name: '拱极星',
      physicalRadius: 0.01,
      raAtEpochDeg: 90,
      decDeg: 60,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 100,
    },
    {
      kind: 'fixed',
      id: 'never_rise',
      name: '永隐星',
      physicalRadius: 0.01,
      raAtEpochDeg: 270,
      decDeg: -60,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 100,
    },
  ],
};

/**
 * 可手算的高度角期望。
 * boundary=true 表示该时刻处于地平线临界（|h| < 1e-9），
 * 此时只校验 |h| 与「aboveHorizon === (h >= 0)」的策略一致性，
 * 不对布尔值做硬编码（临界符号由浮点决定，但必须是确定性的）。
 */
export interface HorizonExpectation {
  tick: number;
  bodyId: string;
  altitudeDeg: number;
  aboveHorizon: boolean;
  boundary?: boolean;
}

export const horizonExpectations: HorizonExpectation[] = [
  { tick: 0, bodyId: 'equator_east', altitudeDeg: 45, aboveHorizon: true },
  { tick: 3, bodyId: 'equator_east', altitudeDeg: 30, aboveHorizon: true },
  { tick: 6, bodyId: 'equator_east', altitudeDeg: 0, aboveHorizon: true, boundary: true },
  { tick: 9, bodyId: 'equator_east', altitudeDeg: -30, aboveHorizon: false },
  { tick: 12, bodyId: 'equator_east', altitudeDeg: -45, aboveHorizon: false },
  { tick: 18, bodyId: 'equator_east', altitudeDeg: 0, aboveHorizon: true, boundary: true },
  { tick: 21, bodyId: 'equator_east', altitudeDeg: 30, aboveHorizon: true },
  { tick: 6, bodyId: 'circumpolar', altitudeDeg: 75, aboveHorizon: true },
  { tick: 18, bodyId: 'circumpolar', altitudeDeg: 15, aboveHorizon: true },
  { tick: 6, bodyId: 'never_rise', altitudeDeg: -75, aboveHorizon: false },
  { tick: 18, bodyId: 'never_rise', altitudeDeg: -15, aboveHorizon: false },
];
