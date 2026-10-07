/**
 * 示例织造数据：三台织机、四张订单、若干工序。
 * 其中故意包含一组固定指派冲突与一张交付偏紧的订单，
 * 用于演示「保留双方 + 可追溯依据」的冲突裁决。
 */
import type { ScheduleInput } from './types'

export function sampleInput(): ScheduleInput {
  return {
    originDate: '2026-10-08',
    looms: [
      {
        id: 'loom-hualou-da',
        name: '大花楼织机',
        efficiency: 1.0,
        workPeriods: [
          { startMin: 480, endMin: 720 },
          { startMin: 840, endMin: 1080 },
        ],
      },
      {
        id: 'loom-hualou-xiao',
        name: '小花楼织机',
        efficiency: 1.2,
        workPeriods: [
          { startMin: 480, endMin: 720 },
          { startMin: 840, endMin: 1080 },
        ],
      },
      {
        id: 'loom-kesi',
        name: '缂丝机',
        efficiency: 0.8,
        workPeriods: [
          { startMin: 540, endMin: 720 },
          { startMin: 840, endMin: 1020 },
        ],
      },
    ],
    orders: [
      {
        id: 'order-huaniao',
        name: '花鸟卷轴',
        priority: 1,
        dueMin: 3 * 1440,
        operations: [
          { id: 'op-hn-tiaojing', orderId: 'order-huaniao', name: '挑经', sequence: 1, baseMinutes: 120, loomIds: ['loom-hualou-da', 'loom-hualou-xiao'] },
          { id: 'op-hn-yinwei', orderId: 'order-huaniao', name: '引纬', sequence: 2, baseMinutes: 240, loomIds: ['loom-hualou-da', 'loom-hualou-xiao'] },
          { id: 'op-hn-zhizao', orderId: 'order-huaniao', name: '织造', sequence: 3, baseMinutes: 480, loomIds: ['loom-hualou-da'] },
          { id: 'op-hn-shoujuan', orderId: 'order-huaniao', name: '收卷', sequence: 4, baseMinutes: 60, loomIds: ['loom-hualou-da', 'loom-hualou-xiao', 'loom-kesi'] },
        ],
      },
      {
        id: 'order-tuanhua',
        name: '团花补子',
        priority: 1,
        dueMin: 1500,
        operations: [
          { id: 'op-th-tiaojing', orderId: 'order-tuanhua', name: '挑经', sequence: 1, baseMinutes: 90, loomIds: ['loom-hualou-xiao'] },
          { id: 'op-th-zhizao', orderId: 'order-tuanhua', name: '织造', sequence: 2, baseMinutes: 600, loomIds: ['loom-hualou-xiao', 'loom-kesi'] },
        ],
      },
      {
        id: 'order-shanshui',
        name: '山水屏条',
        priority: 2,
        dueMin: 4 * 1440,
        operations: [
          { id: 'op-ss-tiaojing', orderId: 'order-shanshui', name: '挑经', sequence: 1, baseMinutes: 90, loomIds: ['loom-hualou-xiao'] },
          { id: 'op-ss-yinwei', orderId: 'order-shanshui', name: '引纬', sequence: 2, baseMinutes: 180, loomIds: ['loom-hualou-da', 'loom-hualou-xiao'] },
          { id: 'op-ss-zhizao', orderId: 'order-shanshui', name: '织造', sequence: 3, baseMinutes: 360, loomIds: ['loom-hualou-xiao'] },
        ],
      },
      {
        id: 'order-hebao',
        name: '荷包纹样',
        priority: 3,
        operations: [
          { id: 'op-hb-tiaojing', orderId: 'order-hebao', name: '挑经', sequence: 1, baseMinutes: 60, loomIds: ['loom-kesi'] },
          {
            id: 'op-hb-zhizao',
            orderId: 'order-hebao',
            name: '织造',
            sequence: 2,
            baseMinutes: 150,
            loomIds: ['loom-kesi'],
            pinned: { loomId: 'loom-kesi', startMin: 600 },
          },
          {
            id: 'op-hb-xiubu',
            orderId: 'order-hebao',
            name: '修补',
            sequence: 3,
            baseMinutes: 45,
            loomIds: ['loom-kesi'],
            pinned: { loomId: 'loom-kesi', startMin: 660 },
          },
        ],
      },
    ],
  }
}

/** 参数修正示例：两道序工时与一台织机效率被修正。 */
export function sampleTweaks(input: ScheduleInput): ScheduleInput {
  const next: ScheduleInput = JSON.parse(JSON.stringify(input))
  const kesi = next.looms.find((l) => l.id === 'loom-kesi')
  if (kesi) kesi.efficiency = 0.9
  for (const order of next.orders) {
    for (const op of order.operations) {
      if (op.id === 'op-ss-zhizao') op.baseMinutes = 300
      if (op.id === 'op-th-zhizao') op.baseMinutes = 560
    }
  }
  return next
}
