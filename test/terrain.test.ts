import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import { TerrainGenerator } from '../src/game/TerrainGenerator';
import { createSeededRandom } from '../src/game/core/random';
import { checkHerbPosition, DEFAULT_PLACEMENT_CONFIG } from '../src/game/core/placement';

function generateSnapshot(seed: number) {
  const generator = new TerrainGenerator(100, 16, createSeededRandom(seed));
  const data = generator.generate();
  return {
    herbs: data.herbs.map((h) => h.getData()),
    positions: data.herbPositions.map((p) => ({ x: p.x, y: p.y, z: p.z }))
  };
}

describe('地形生成（含渲染层的确定性验证）', () => {
  it('同种子两次生成：草药分布与数据完全一致', () => {
    assertDeepEqual(generateSnapshot(123), generateSnapshot(123), '同种子地形必须完全可复现');
  });

  it('草药数量严格等于 25，且每株满足落点约束', () => {
    const generator = new TerrainGenerator(100, 16, createSeededRandom(456));
    const data = generator.generate();
    assertEqual(data.herbs.length, 25, '草药数量必须为 25，不允许静默缺数');
    assertEqual(data.herbPositions.length, 25, '位置列表数量必须为 25');

    data.herbPositions.forEach((p, i) => {
      const check = checkHerbPosition(p.x, p.z, generator.getHeightAt(p.x, p.z), DEFAULT_PLACEMENT_CONFIG);
      assert(check.valid, `第 ${i} 株落点违反约束: ${check.reasons.join('; ')}`);
    });
  });

  it('多组种子均满足约束（批量回归）', () => {
    for (let seed = 10; seed < 20; seed++) {
      const generator = new TerrainGenerator(100, 16, createSeededRandom(seed));
      const data = generator.generate();
      assertEqual(data.herbs.length, 25, `种子 ${seed} 草药数量必须为 25`);
      data.herbPositions.forEach((p, i) => {
        const check = checkHerbPosition(p.x, p.z, generator.getHeightAt(p.x, p.z), DEFAULT_PLACEMENT_CONFIG);
        assert(check.valid, `种子 ${seed} 第 ${i} 株违反约束: ${check.reasons.join('; ')}`);
      });
    }
  });
});
