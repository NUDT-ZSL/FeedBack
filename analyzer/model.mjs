/**
 * 调用链归因核心 —— 数据模型与公共常量。
 *
 * 输入样本（调用链样本）结构：
 *   { sampleId: string, spans: [{ id: string, parentId: string|null, duration: number }] }
 *
 * 同一节点 id 可出现在多个样本中（共享节点）；归因按“根到叶”的调用路径逐层进行，
 * 共享节点在每条经过它的路径下独立记录贡献，贡献 = duration / 经过该节点的路径数，
 * 从而保证：所有路径的累计耗时之和 == 全部节点耗时之和（耗时守恒）。
 */

export const ANALYZER_VERSION = '1.0.0';

export const DiagnosticCode = Object.freeze({
  DUPLICATE_SPAN: 'DUPLICATE_SPAN',       // 同一样本内节点 id 重复，仅首次出现生效
  DURATION_CONFLICT: 'DURATION_CONFLICT', // 同一节点多次出现且耗时取值不一致
  INVALID_DURATION: 'INVALID_DURATION',   // 耗时缺失/非有限数值，按 0 处理
  NEGATIVE_DURATION: 'NEGATIVE_DURATION', // 耗时为负，按 0 处理
  MISSING_PARENT: 'MISSING_PARENT',       // 父引用指向不存在的节点，边被丢弃、节点保留为根
  CYCLE_EDGE: 'CYCLE_EDGE',               // 引用成环，按确定性规则断开的边
});

export const PATH_SEPARATOR = '>';

/** 统一数值精度，保证全量/增量/不同导入顺序下输出可逐位比较。 */
export function round6(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

export function pathKey(path) {
  return path.join(PATH_SEPARATOR);
}

/** 耗时字段规整：返回 { value, diagnosticCode|null }。 */
export function coerceDuration(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { value: 0, diagnosticCode: DiagnosticCode.INVALID_DURATION };
  }
  if (raw < 0) {
    return { value: 0, diagnosticCode: DiagnosticCode.NEGATIVE_DURATION };
  }
  return { value: raw, diagnosticCode: null };
}

export function occurrenceKey(sampleId, spanId, indexInSample) {
  return `${sampleId}::${spanId}::${String(indexInSample).padStart(6, '0')}`;
}

/** 诊断信息排序，保证报告与导入顺序无关。 */
export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) => {
    const ka = `${a.code}::${a.nodeId ?? ''}::${a.detail ?? ''}`;
    const kb = `${b.code}::${b.nodeId ?? ''}::${b.detail ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
