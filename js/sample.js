/* sample.js — 内置示例数据：覆盖坐标缺失/越界/有效期矛盾/压线/类别冲突/范围重叠等情形 */
window.SAMPLE_DATA = {
  world: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  objects: [
    // obj-a：两个来源完全一致 —— 可信
    { objectId: 'obj-a', source: 'gps-1', coord: { x: 20, y: 20 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: 'GPS 例行上报' },
    { objectId: 'obj-a', source: 'manual-1', coord: { x: 20, y: 20 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: '人工巡检确认' },
    // obj-b：两个来源坐标矛盾 —— 待裁决，不得参与排序
    { objectId: 'obj-b', source: 'gps-2', coord: { x: 35, y: 25 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: 'GPS 上报' },
    { objectId: 'obj-b', source: 'drone-1', coord: { x: 38, y: 28 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: '无人机复测' },
    // obj-c：所有来源均缺坐标 —— 不可信
    { objectId: 'obj-c', source: 'lora-1', category: 'sensor', validFrom: '2026-01-01', validTo: '2026-12-31', note: '仅心跳，无定位' },
    { objectId: 'obj-c', source: 'lora-2', category: 'sensor', validFrom: '2026-03-01', validTo: '2026-12-31', note: '补登，仍无定位' },
    // obj-d：坐标越出世界边界 —— 标不可信但保留来源
    { objectId: 'obj-d', source: 'gps-3', coord: { x: 150, y: 40 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: '疑似坐标系混用' },
    { objectId: 'obj-d', source: 'gps-3b', coord: { x: 150, y: 40 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: '同源转发' },
    // obj-e：两个来源有效期互不相交 —— 矛盾
    { objectId: 'obj-e', source: 'sys-a', coord: { x: 60, y: 60 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-03-31', note: '一季度登记' },
    { objectId: 'obj-e', source: 'sys-b', coord: { x: 60, y: 60 }, category: 'beacon', validFrom: '2026-09-01', validTo: '2026-12-31', note: '四季度登记' },
    // obj-f：恰好压在 Q1 圆边界上 (30,30)+r15 → (45,30)
    { objectId: 'obj-f', source: 'gps-4', coord: { x: 45, y: 30 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-12-31', note: '压线目标' },
    // obj-g：类别来源矛盾（vip / regular）
    { objectId: 'obj-g', source: 'crm-1', coord: { x: 55, y: 35 }, category: 'vip', validFrom: '2026-01-01', validTo: '2026-12-31', note: 'CRM 标记 vip' },
    { objectId: 'obj-g', source: 'field-2', coord: { x: 55, y: 35 }, category: 'regular', validFrom: '2026-01-01', validTo: '2026-12-31', note: '现场核实 regular' },
    // obj-h：落在 Q1 与 Q2 的重叠区
    { objectId: 'obj-h', source: 'gps-5', coord: { x: 40, y: 30 }, category: 'vip', validFrom: '2026-01-01', validTo: '2026-12-31', note: '重叠区目标' },
    // obj-i：仅在 Q2 内
    { objectId: 'obj-i', source: 'gps-6', coord: { x: 52, y: 38 }, category: 'vip', validFrom: '2026-01-01', validTo: '2026-12-31', note: '普通目标' },
    // obj-j：有效期在基准日 2026-09-24 之前已结束 —— 应被有效期排除
    { objectId: 'obj-j', source: 'gps-7', coord: { x: 33, y: 33 }, category: 'beacon', validFrom: '2026-01-01', validTo: '2026-06-30', note: '已过期目标' }
  ],
  queries: [
    { id: 'Q1', shape: { type: 'circle', cx: 30, cy: 30, r: 15 },
      filters: { categories: ['beacon', 'vip'], asOf: '2026-09-24' },
      expectedBasis: ['来源记录一致性', '有效期覆盖基准日', '闭区间含边界规则'] },
    { id: 'Q2', shape: { type: 'rect', minX: 35, minY: 20, maxX: 60, maxY: 45 },
      filters: { categories: ['vip'], asOf: '2026-09-24' },
      expectedBasis: ['类别过滤', '与 Q1 范围重叠说明'] },
    { id: 'Q3', shape: { type: 'circle', cx: 80, cy: 80, r: 10 },
      filters: { categories: [], asOf: '2026-09-24' },
      expectedBasis: ['空区域排除依据'] }
  ]
};
