/**
 * 判定链路数据模型（纯数据，JSON 可表达）：
 *
 * 空间记录 SpatialRecord：
 *   { id, objectId, timestamp, state, links?: string[], priority?: number }
 *   - state     对象在该时刻的状态快照（任意 JSON 对象）
 *   - links     指向其他记录的关联（推导依赖边），缺省视为空
 *   - priority  矛盾裁决时的优先级，缺省为 0
 *
 * 关键事件 KeyEvent：
 *   { id, timestamp, kind, links?: string[], status?: 'active' | 'withdrawn' }
 *
 * 异常条目 Anomaly（可追溯归属，绝不静默跳过）：
 *   { category: 'link-integrity' | 'duplicate',
 *     code, ownerType: 'record' | 'event', ownerId,
 *     message, details? }
 *
 * 数据集 Dataset（导入完成后的不可变快照）：
 *   { records: Map<id, record>, events: Map<id, event>,
 *     anomalies: Anomaly[], validLinks: Map<ownerId, string[]> }
 */
export const ANOMALY_CATEGORY = Object.freeze({
  LINK_INTEGRITY: 'link-integrity',
  DUPLICATE: 'duplicate',
});

export const ANOMALY_CODE = Object.freeze({
  MISSING_REFERENCE: 'missing-reference',
  SELF_REFERENCE: 'self-reference',
  REFERENCE_CYCLE: 'reference-cycle',
  INCONSISTENT_DUPLICATE: 'inconsistent-duplicate',
});
