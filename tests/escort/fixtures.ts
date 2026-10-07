import type { EncounterEvent, RouteNode } from '../../src/escort/index.ts';

/** 山贼伏击：损耗 10% 货物，士气 -5，体力 -10 */
export const banditEvent: EncounterEvent = {
  type: 'bandit_ambush',
  cargoLossRate: 0.1,
  moraleDelta: -5,
  staminaDelta: -10,
};

/** 暴雨：损耗 5% 货物，体力 -8 */
export const rainEvent: EncounterEvent = {
  type: 'heavy_rain',
  cargoLossRate: 0.05,
  moraleDelta: 0,
  staminaDelta: -8,
};

/** 正常通行路线：途经 2 个点后到达客栈 */
export const healthyRoute: RouteNode[] = [
  { id: 'gate', name: '镖局大门', kind: 'waypoint', next: 'ridge', encounters: [banditEvent] },
  { id: 'ridge', name: '黄土岭', kind: 'waypoint', next: 'inn', encounters: [banditEvent, banditEvent] },
  { id: 'inn', name: '悦来客栈', kind: 'inn', next: null, encounters: [] },
];

/** 含无法通行节点的路线：第二节点封路 */
export const blockedRoute: RouteNode[] = [
  { id: 'gate', name: '镖局大门', kind: 'waypoint', next: 'broken_bridge', encounters: [banditEvent] },
  { id: 'broken_bridge', name: '断桥', kind: 'blocked', next: 'inn', encounters: [] },
  { id: 'inn', name: '悦来客栈', kind: 'inn', next: null, encounters: [] },
];

/** 含缺失节点的路线：第二节点指向不存在的 ghost_node */
export const missingNodeRoute: RouteNode[] = [
  { id: 'gate', name: '镖局大门', kind: 'waypoint', next: 'ghost_node', encounters: [rainEvent] },
  { id: 'inn', name: '悦来客栈', kind: 'inn', next: null, encounters: [] },
];
