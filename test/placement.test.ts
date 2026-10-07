import { describe, it, assert, assertEqual, assertThrows } from './harness';
import { createSeededRandom } from '../src/game/core/random';
import {
  generateHerbPlacements,
  checkHerbPosition,
  DEFAULT_PLACEMENT_CONFIG,
  streamCenterZ
} from '../src/game/core/placement';
import { createValleyHeightFunction } from '../src/game/core/height';

const heightAt = createValleyHeightFunction(100);
const config = DEFAULT_PLACEMENT_CONFIG;

describe('地形草药布点', () => {
  it('相同种子产出完全一致的落点', () => {
    const a = generateHerbPlacements(createSeededRandom(42), heightAt, config);
    const b = generateHerbPlacements(createSeededRandom(42), heightAt, config);
    assertEqual(JSON.stringify(a), JSON.stringify(b), '同种子布点必须逐点一致');
  });

  it('不同种子产出不同落点（不是伪同结果）', () => {
    const a = generateHerbPlacements(createSeededRandom(1), heightAt, config);
    const b = generateHerbPlacements(createSeededRandom(2), heightAt, config);
    assert(JSON.stringify(a) !== JSON.stringify(b), '不同种子布点应有差异');
  });

  it('草药数量严格等于预期，不发生静默跳过', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = generateHerbPlacements(createSeededRandom(seed), heightAt, config);
      assertEqual(result.points.length, config.count, `种子 ${seed} 的草药数量应为 ${config.count}`);
    }
  });

  it('所有落点满足：远离溪流、位于中心区域、高度受限', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = generateHerbPlacements(createSeededRandom(seed), heightAt, config);
      result.points.forEach((p, i) => {
        const check = checkHerbPosition(p.x, p.z, heightAt(p.x, p.z), config);
        assert(
          check.fromStream > config.minStreamDistance,
          `种子${seed} 第${i}株距溪流 ${check.fromStream} 应大于 ${config.minStreamDistance}`
        );
        assert(
          check.fromStream > config.minStreamDistance && check.valid,
          `种子${seed} 第${i}株约束未通过: ${check.reasons.join('; ')}`
        );
        assert(
          check.fromCenter < config.maxCenterDistance,
          `种子${seed} 第${i}株距中心 ${check.fromCenter} 应小于 ${config.maxCenterDistance}`
        );
        assert(check.height < config.maxHeight, `种子${seed} 第${i}株高度 ${check.height} 应小于 ${config.maxHeight}`);
        assertEqual(p.y, heightAt(p.x, p.z) + config.groundOffset, `种子${seed} 第${i}株 y 应为地表+抬升`);
      });
    }
  });

  it('拒绝次数被如实记录（边界拒绝发生且未静默丢弃草药）', () => {
    // 用一个极严格的配置逼迫大量拒绝：高度上限收紧
    const strict = { ...config, count: 10, randomAttempts: 5, maxHeight: 2 };
    const result = generateHerbPlacements(createSeededRandom(7), heightAt, strict);
    assertEqual(result.points.length, 10, '即使拒绝频发，数量仍必须补齐');
    const someRejections = result.rejectionCounts.some((c) => c > 0);
    assert(someRejections, '严格约束下应至少发生过拒绝采样（否则用例未覆盖到该路径）');
  });

  it('随机尝试全部被拒绝时走确定性兜底，结果仍可复现', () => {
    const strict = { ...config, count: 10, randomAttempts: 1, maxHeight: 2 };
    const a = generateHerbPlacements(createSeededRandom(99), heightAt, strict);
    const b = generateHerbPlacements(createSeededRandom(99), heightAt, strict);
    assertEqual(JSON.stringify(a), JSON.stringify(b), '兜底路径也必须可复现');
    assertEqual(a.points.length, 10, '兜底路径必须补齐数量');
  });

  it('约束在物理上不可满足时显式抛错，而不是静默缺数', () => {
    // 中心区域小到近原点、溪流安全距离大到覆盖全域：任何候选都不可能同时满足
    const impossible = {
      ...config,
      size: 8,
      count: 3,
      maxCenterDistance: 0.01,
      minStreamDistance: 100,
      edgeMargin: 1,
      randomAttempts: 5
    };
    let threw = false;
    let message = '';
    try {
      generateHerbPlacements(createSeededRandom(3), heightAt, impossible);
    } catch (error) {
      threw = true;
      message = error instanceof Error ? error.message : '';
    }
    assert(threw, '不可行配置必须抛出异常');
    assert(/草药布点失败/.test(message), `异常信息应带诊断内容，实际: ${message}`);
  });

  it('溪流中线公式与地形渲染一致', () => {
    assertEqual(streamCenterZ(-30), 0, '溪流起点 z=0');
    assertEqual(streamCenterZ(30), -8, '溪流终点 sin(1.5π)*8 = -8');
    assert(Math.abs(streamCenterZ(-10) - Math.sin((20 / 60) * Math.PI * 1.5) * 8) < 1e-12, '溪流曲线一致');
  });
});
