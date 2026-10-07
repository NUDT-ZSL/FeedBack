/**
 * 默认推演样例：浑天仪六行星（水星/金星/火星/木星/土星/月亮）。
 *
 * 数据为本地固定输入（轨道根数取自技术架构文档中的初始化配置，
 * 平均运动取固定常数），不查询任何外部星历服务。
 * tick 约定：1 tick = 1 恒星时，观测站自转 15 度/tick。
 */

import { SimulationConfig } from '../types';

export const DEFAULT_TICKS_PER_SIDEREAL_DAY = 24;

export const defaultSystem: SimulationConfig = {
  observer: {
    latitudeDeg: 34.3,
    lstAtEpochDeg: 0,
    lstRateDegPerTick: 15,
    epochTick: 0,
  },
  bodies: [
    {
      kind: 'orbital',
      id: 'mercury',
      name: '水星',
      physicalRadius: 0.3,
      semiMajorAxis: 7,
      eccentricity: 0.205,
      inclinationDeg: 7,
      ascendingNodeDeg: 48.33,
      argOfPeriapsisDeg: 29.12,
      meanAnomalyAtEpochDeg: 174.8,
      meanMotionDegPerTick: 1.0383,
      epochTick: 0,
    },
    {
      kind: 'orbital',
      id: 'venus',
      name: '金星',
      physicalRadius: 0.35,
      semiMajorAxis: 8.5,
      eccentricity: 0.007,
      inclinationDeg: 3.39,
      ascendingNodeDeg: 76.68,
      argOfPeriapsisDeg: 54.88,
      meanAnomalyAtEpochDeg: 50.4,
      meanMotionDegPerTick: 0.6166,
      epochTick: 0,
    },
    {
      kind: 'orbital',
      id: 'mars',
      name: '火星',
      physicalRadius: 0.4,
      semiMajorAxis: 10,
      eccentricity: 0.093,
      inclinationDeg: 1.85,
      ascendingNodeDeg: 49.56,
      argOfPeriapsisDeg: 286.5,
      meanAnomalyAtEpochDeg: 19.4,
      meanMotionDegPerTick: 0.524,
      epochTick: 0,
    },
    {
      kind: 'orbital',
      id: 'jupiter',
      name: '木星',
      physicalRadius: 0.6,
      semiMajorAxis: 12,
      eccentricity: 0.049,
      inclinationDeg: 1.3,
      ascendingNodeDeg: 100.5,
      argOfPeriapsisDeg: 273.9,
      meanAnomalyAtEpochDeg: 20.0,
      meanMotionDegPerTick: 0.0831,
      epochTick: 0,
    },
    {
      kind: 'orbital',
      id: 'saturn',
      name: '土星',
      physicalRadius: 0.5,
      semiMajorAxis: 14,
      eccentricity: 0.057,
      inclinationDeg: 2.49,
      ascendingNodeDeg: 113.7,
      argOfPeriapsisDeg: 339.4,
      meanAnomalyAtEpochDeg: 317.0,
      meanMotionDegPerTick: 0.0335,
      epochTick: 0,
    },
    {
      kind: 'orbital',
      id: 'moon',
      name: '月亮',
      physicalRadius: 0.32,
      semiMajorAxis: 6,
      eccentricity: 0.055,
      inclinationDeg: 5.14,
      ascendingNodeDeg: 125.1,
      argOfPeriapsisDeg: 318.2,
      meanAnomalyAtEpochDeg: 135.3,
      meanMotionDegPerTick: 1.2,
      epochTick: 0,
    },
  ],
};
