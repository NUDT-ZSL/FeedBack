import type { HerbData } from '../types';
import { HERB_TYPES } from '../types';
import type { RandomSource } from './random';
import type { HerbPosition } from './terrain';

/**
 * 由注入的随机源生成一株草药的确定性数据。
 * 相同的 (position, random 序列, id) 永远得到相同的 HerbData。
 */
export function createHerbData(position: HerbPosition, random: RandomSource, id: string): HerbData {
  const herbType = HERB_TYPES[Math.floor(random() * HERB_TYPES.length)];

  return {
    id,
    name: herbType.name,
    element: herbType.element,
    color: herbType.color,
    potency: 0.5 + random() * 0.5,
    position: { x: position.x, y: position.y, z: position.z }
  };
}
