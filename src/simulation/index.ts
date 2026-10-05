/** 独立推演能力统一入口：界面与离线脚本都只通过这里获取结果 */
export * from './types.ts';
export {
  PRECISION,
  round,
  degreesToRadians,
  wheelSpeed,
  validateScenario,
  runScenario,
  canonicalize,
  fnv1a,
  checksumResult,
  orderResultRecords,
} from './engine.ts';
export { recompute, verifyIncrementalConsistency } from './incremental.ts';
export type { SimulationCache, RecomputeReport } from './incremental.ts';
export { createSampleScenario } from './sampleData.ts';
