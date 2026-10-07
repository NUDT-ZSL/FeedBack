/**
 * 星体互掩专用样例（赤道观测站，1 tick = 1 恒星时）：
 *
 * - near：距离 10、半径 0.5 的较近恒星，RA 以 0.5°/tick 漂移；
 * - far：距离 30、半径 0.3 的较远恒星，固定在 RA=90°；
 *   两者在 t=180 时视线重合（且高度角恰为 45°，远离地平线），
 *   near 应在约 t=180 前后一段窗口内遮挡 far；
 * - bystander：独立方向恒星，永不参与遮挡；
 * - south_pole：距观测者仅 5（物理上最近）的南天恒星（赤纬 -45°），
 *   在观测窗口内有相当长时段位于地平线下，
 *   用于验证「地平线下的更近星体不得遮挡任何人」。
 */

import { SimulationConfig } from '../types';

export const occultationSystem: SimulationConfig = {
  observer: {
    latitudeDeg: 0,
    lstAtEpochDeg: 315,
    lstRateDegPerTick: 15,
    epochTick: 0,
  },
  bodies: [
    {
      kind: 'fixed',
      id: 'near',
      name: '近距星',
      physicalRadius: 0.5,
      raAtEpochDeg: 0,
      decDeg: 0,
      raDriftDegPerTick: 0.5,
      epochTick: 0,
      distance: 10,
    },
    {
      kind: 'fixed',
      id: 'far',
      name: '远距星',
      physicalRadius: 0.3,
      raAtEpochDeg: 90,
      decDeg: 0,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 30,
    },
    {
      kind: 'fixed',
      id: 'bystander',
      name: '旁观星',
      physicalRadius: 0.2,
      raAtEpochDeg: 200,
      decDeg: 0,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 25,
    },
    {
      kind: 'fixed',
      id: 'south_pole',
      name: '南天隐星',
      physicalRadius: 0.4,
      raAtEpochDeg: 0,
      decDeg: -45,
      raDriftDegPerTick: 0,
      epochTick: 0,
      distance: 5,
    },
  ],
};

/** 视线重合 tick：near 的 RA(=0.5·tick) 等于 far 的 RA(=90) */
export const OCCULTATION_CONJUNCTION_TICK = 180;
/** 重合时两星高度角（度） */
export const OCCULTATION_CONJUNCTION_ALTITUDE = 45;
