// 轨迹推演模块统一出口：类型 + 纯函数算法 + 增量推演引擎。
export * from './types.ts';
export {
  haversineMeters,
  validatePoints,
  segmentValidPoints,
  segmentTrajectory,
} from './segmentation.ts';
export {
  pairKey,
  detectCompanionshipForPair,
  detectCompanionship,
} from './companionship.ts';
export { TrajectoryEngine } from './engine.ts';
export type { PointPatch, ParamsPatch } from './engine.ts';
