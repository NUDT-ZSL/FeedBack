import { describe, it, assert, assertEqual } from './harness';
import { findCollectibleHerb } from '../src/game/core/collection';
import { HerbData } from '../src/types';

function herb(id: string, x: number, z: number): { data: HerbData } {
  return {
    data: {
      id,
      name: id,
      element: '木',
      color: 0x228b22,
      potency: 0.6,
      position: { x, y: 0, z }
    }
  };
}

describe('采集选择', () => {
  it('仅采集半径内最近的草药', () => {
    const herbs = [herb('far', 5, 0), herb('near', 1, 0), herb('alsoFar', -4, 0)];
    assertEqual(findCollectibleHerb({ x: 0, y: 0, z: 0 }, herbs, 1.5), 1, '应选中 1 单位外的 near');
  });

  it('半径内无草药返回 -1（确定性地采不到）', () => {
    const herbs = [herb('far', 3, 0)];
    assertEqual(findCollectibleHerb({ x: 0, y: 0, z: 0 }, herbs, 1.5), -1, '距离 3 应采不到');
  });

  it('等距时取下标最小者（顺序稳定，不依赖帧时序）', () => {
    const herbs = [herb('a', 1, 0), herb('b', 0, 1)];
    assertEqual(findCollectibleHerb({ x: 0, y: 0, z: 0 }, herbs, 1.5), 0, '等距选下标最小者');
  });
});
