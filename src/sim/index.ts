/**
 * 浑天仪推演纯计算层统一出口。
 *
 * 位置计算、可见性/遮挡判定、完成度统计均在此导出，
 * 不依赖 DOM / three.js，浏览器渲染层与离线批量验证共用同一实现。
 */

export * from './types';
export { Simulation, TimelineCursor } from './engine';
export {
  evaluateVisibility,
  equatorialToHorizontal,
  angularSeparationDeg,
  angularRadiusDeg,
  VISIBILITY_POLICY,
} from './visibility';
export {
  bodyPosition,
  localSiderealTime,
  toEquatorialSpherical,
} from './ephemeris';
export {
  computeTickCompletion,
  accumulate,
} from './stats';
export type { TickCompletion, AccumulatedStats } from './stats';
export { defaultSystem, DEFAULT_TICKS_PER_SIDEREAL_DAY } from './fixtures/defaultSystem';
export { horizonSystem, horizonExpectations } from './fixtures/horizonSystem';
export type { HorizonExpectation } from './fixtures/horizonSystem';
export {
  occultationSystem,
  OCCULTATION_CONJUNCTION_TICK,
  OCCULTATION_CONJUNCTION_ALTITUDE,
} from './fixtures/occultationSystem';
