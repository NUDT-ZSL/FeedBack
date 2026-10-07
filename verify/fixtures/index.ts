/**
 * 验证用固定数据集：覆盖正常排布、边界条件与失败路径。
 * 时间单位均为分钟，自推演纪元起算。
 */
import type { SchedulingInput } from '../../src/scheduling/types.ts';

/** 正常数据集：4 台织机、2 张订单、8 道工序；穿经类型存在跨织机不同优先级覆盖 */
export const normalInput: SchedulingInput = {
  looms: [
    { id: 'L1', name: '1号织机', dailyCapacityMinutes: 960 },
    { id: 'L2', name: '2号织机', dailyCapacityMinutes: 960 },
    { id: 'L3', name: '3号织机', dailyCapacityMinutes: 480 },
    { id: 'L4', name: '4号织机', dailyCapacityMinutes: 960 },
  ],
  orders: [
    { id: 'O1', name: '订单甲', releaseMinute: 0, dueMinute: 2000 },
    { id: 'O2', name: '订单乙', releaseMinute: 100, dueMinute: 3000 },
  ],
  capabilities: [
    { loomId: 'L1', processType: '整经', priority: 0 },
    { loomId: 'L2', processType: '整经', priority: 0 },
    { loomId: 'L1', processType: '穿经', priority: 1 },
    { loomId: 'L2', processType: '穿经', priority: 0 },
    { loomId: 'L3', processType: '穿经', priority: 0 },
    { loomId: 'L3', processType: '织造', priority: 0 },
    { loomId: 'L4', processType: '织造', priority: 0 },
    { loomId: 'L4', processType: '验布', priority: 0 },
  ],
  steps: [
    { id: 's_warp', orderId: 'O1', processType: '整经', standardMinutes: 120, dependsOn: [] },
    { id: 's_draft', orderId: 'O1', processType: '穿经', standardMinutes: 100, dependsOn: ['s_warp'] },
    { id: 's_weave', orderId: 'O1', processType: '织造', standardMinutes: 300, dependsOn: ['s_draft'] },
    { id: 's_inspect', orderId: 'O1', processType: '验布', standardMinutes: 60, dependsOn: ['s_weave'] },
    { id: 't_warp', orderId: 'O2', processType: '整经', standardMinutes: 120, dependsOn: [] },
    { id: 't_draft', orderId: 'O2', processType: '穿经', standardMinutes: 100, dependsOn: ['t_warp'] },
    { id: 't_weave', orderId: 'O2', processType: '织造', standardMinutes: 300, dependsOn: ['t_draft'] },
    { id: 't_inspect', orderId: 'O2', processType: '验布', standardMinutes: 60, dependsOn: ['t_weave'] },
  ],
};

/** 边界：单机无空档首尾相接 */
export const tightChainInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [{ loomId: 'M1', processType: 'X', priority: 0 }],
  steps: [
    { id: 'a', orderId: 'O', processType: 'X', standardMinutes: 60, dependsOn: [] },
    { id: 'b', orderId: 'O', processType: 'X', standardMinutes: 60, dependsOn: ['a'] },
    { id: 'c', orderId: 'O', processType: 'X', standardMinutes: 60, dependsOn: ['b'] },
  ],
};

/** 边界：同优先级同空档，按织机 id 字典序裁决 */
export const loomIdTieInput: SchedulingInput = {
  looms: [
    { id: 'MB', name: 'B机', dailyCapacityMinutes: 960 },
    { id: 'MA', name: 'A机', dailyCapacityMinutes: 960 },
  ],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [
    { loomId: 'MB', processType: 'X', priority: 0 },
    { loomId: 'MA', processType: 'X', priority: 0 },
  ],
  steps: [{ id: 'x1', orderId: 'O', processType: 'X', standardMinutes: 50, dependsOn: [] }],
};

/** 边界：投料时刻约束开工 */
export const releaseGatedInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '晚投料', releaseMinute: 100, dueMinute: 500 }],
  capabilities: [{ loomId: 'M1', processType: 'X', priority: 0 }],
  steps: [{ id: 'x1', orderId: 'O', processType: 'X', standardMinutes: 50, dependsOn: [] }],
};

/** 边界：优先级压过最早空档（高优先级织机被占 300 分钟，仍优于空闲的低优先级织机） */
export const priorityOverEarliestInput: SchedulingInput = {
  looms: [
    { id: 'LA', name: '低优先机', dailyCapacityMinutes: 960 },
    { id: 'LB', name: '高优先机', dailyCapacityMinutes: 960 },
  ],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 2000 }],
  capabilities: [
    { loomId: 'LA', processType: 'X', priority: 2 },
    { loomId: 'LB', processType: 'X', priority: 0 },
    { loomId: 'LB', processType: 'Y', priority: 0 },
  ],
  steps: [
    { id: 'y1', orderId: 'O', processType: 'Y', standardMinutes: 300, dependsOn: [] },
    { id: 'z1', orderId: 'O', processType: 'X', standardMinutes: 60, dependsOn: [] },
  ],
};

/** 边界：两条互不相干的工序链分别独占织机（用于增量局部性证明） */
export const isolatedChainsInput: SchedulingInput = {
  looms: [
    { id: 'PA', name: '甲链织机', dailyCapacityMinutes: 960 },
    { id: 'PB', name: '乙链织机', dailyCapacityMinutes: 960 },
  ],
  orders: [
    { id: 'OA', name: '甲订单', releaseMinute: 0, dueMinute: 2000 },
    { id: 'OB', name: '乙订单', releaseMinute: 0, dueMinute: 2000 },
  ],
  capabilities: [
    { loomId: 'PA', processType: 'A类', priority: 0 },
    { loomId: 'PB', processType: 'B类', priority: 0 },
  ],
  steps: [
    { id: 'a1', orderId: 'OA', processType: 'A类', standardMinutes: 60, dependsOn: [] },
    { id: 'a2', orderId: 'OA', processType: 'A类', standardMinutes: 60, dependsOn: ['a1'] },
    { id: 'b1', orderId: 'OB', processType: 'B类', standardMinutes: 60, dependsOn: [] },
    { id: 'b2', orderId: 'OB', processType: 'B类', standardMinutes: 60, dependsOn: ['b1'] },
  ],
};

/** 失败：依赖闭环 a -> b -> c -> a */
export const cycleInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [{ loomId: 'M1', processType: 'X', priority: 0 }],
  steps: [
    { id: 'a', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: ['c'] },
    { id: 'b', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: ['a'] },
    { id: 'c', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: ['b'] },
  ],
};

/** 失败：能力指向不存在的织机 GHOST，且工序依赖指向不存在的工序 NOPE */
export const missingRefInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [
    { loomId: 'M1', processType: 'X', priority: 0 },
    { loomId: 'GHOST', processType: 'X', priority: 0 },
  ],
  steps: [
    { id: 'a', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: ['NOPE'] },
    { id: 'b', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: ['a'] },
  ],
};

/** 失败：工序类型“染色”没有任何织机具备能力 */
export const capabilityGapInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [{ loomId: 'M1', processType: 'X', priority: 0 }],
  steps: [
    { id: 'a', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: [] },
    { id: 'd1', orderId: 'O', processType: '染色', standardMinutes: 40, dependsOn: ['a'] },
  ],
};

/** 失败路径（增量用）：工序类型唯一能力被移除后产生能力缺口 */
export const soleCapabilityInput: SchedulingInput = {
  looms: [{ id: 'M1', name: '单机', dailyCapacityMinutes: 960 }],
  orders: [{ id: 'O', name: '单订单', releaseMinute: 0, dueMinute: 1000 }],
  capabilities: [{ loomId: 'M1', processType: 'X', priority: 0 }],
  steps: [{ id: 'x1', orderId: 'O', processType: 'X', standardMinutes: 30, dependsOn: [] }],
};
