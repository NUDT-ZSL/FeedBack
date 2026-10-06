/**
 * 数据驱动的检查器。每个检查类型接收用例上下文与用例中声明的参数，
 * 返回 { failures: [...], artifacts: {...} }；断言内容全部来自用例数据，
 * 运行器不针对任何具体用例写死断言。
 */

import { analyze, createEngine, canonicalString } from '../../analyzer/index.js';
import { computeExpectations, projectAffectedPaths } from './projections.js';
import { diffValues } from './diff.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const out = [...list];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 生成确定性的导入顺序变体：同时打乱 trace 顺序与每个 trace 内的节点顺序。 */
function importOrders(samples) {
  const orders = [{ name: 'identity', samples }];
  const variants = [
    { name: 'reversed', seed: null },
    { name: 'shuffle#1', seed: 1 },
    { name: 'shuffle#2', seed: 2 },
    { name: 'shuffle#3', seed: 3 },
  ];
  for (const variant of variants) {
    const traceOrder = variant.seed === null ? [...samples].reverse() : shuffled(samples, variant.seed);
    const reordered = traceOrder.map((trace, index) => ({
      ...trace,
      nodes:
        variant.seed === null
          ? [...(trace.nodes ?? [])].reverse()
          : shuffled(trace.nodes ?? [], variant.seed * 1000 + index),
    }));
    orders.push({ name: variant.name, samples: reordered });
  }
  return orders;
}

// 期望投影按形状取子集：用例只需声明关心的键，未声明的键不参与断言
function subsetOf(shape, value) {
  if (Array.isArray(shape) || shape === null || typeof shape !== 'object') return value;
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(shape)) out[key] = subsetOf(shape[key], value[key]);
  return out;
}

function compareExpectations(result, expect, failures, label) {
  const actual = computeExpectations(result, expect);
  for (const key of Object.keys(expect)) {
    for (const line of diffValues(expect[key], subsetOf(expect[key], actual[key]))) {
      failures.push(`${label} ${key}: ${line}`);
    }
  }
}

export const checks = {
  /** 全量归因结论与期望投影一致。 */
  attribution(ctx, check) {
    const failures = [];
    compareExpectations(ctx.analysis, check.expect ?? {}, failures, 'attribution');
    return { failures, artifacts: {} };
  },

  /** 同一批样本在不同导入顺序下归因结论一致。 */
  'order-invariance'(ctx) {
    const failures = [];
    const baseline = canonicalString(ctx.analysis);
    for (const order of importOrders(ctx.testCase.samples)) {
      const actual = canonicalString(analyze(order.samples));
      if (actual !== baseline) {
        failures.push(`order-invariance: attribution differs under import order '${order.name}'`);
      }
    }
    return { failures, artifacts: {} };
  },

  /**
   * 节点数据修正：只重算受影响路径，且增量结果必须与全量重算一致。
   * 同时校验用例中声明的受影响路径集合与修正后的归因投影。
   */
  incremental(ctx, check) {
    const failures = [];
    const engine = createEngine(ctx.testCase.samples);
    const { result, evidence } = engine.correct(check.corrections ?? []);

    const fullRecompute = analyze(engine.exportSamples());
    if (canonicalString(result) !== canonicalString(fullRecompute)) {
      failures.push('incremental: incremental result differs from full recompute');
      for (const line of diffValues(fullRecompute, result)) {
        failures.push(`incremental vs full: ${line}`);
      }
    }

    const expect = check.expect ?? {};
    const { affectedPaths, ...resultExpect } = expect;
    compareExpectations(result, resultExpect, failures, 'incremental');
    if (affectedPaths !== undefined) {
      const actualAffected = projectAffectedPaths(evidence);
      for (const line of diffValues(affectedPaths, subsetOf(affectedPaths, actualAffected))) {
        failures.push(`incremental affectedPaths: ${line}`);
      }
    }
    return { failures, artifacts: { evidence, incrementalResult: result, fullRecompute } };
  },
};
