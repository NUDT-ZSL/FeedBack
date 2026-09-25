import { createSeededRandom } from '../random';
import { assert, equal, test } from './harness';

test('随机源：相同种子序列相同，不同种子序列不同', () => {
  const firstA = createSeededRandom(42);
  const firstB = createSeededRandom(42);
  const second = createSeededRandom(43);

  const valuesA = Array.from({ length: 20 }, () => firstA());
  const valuesB = Array.from({ length: 20 }, () => firstB());
  const valuesC = Array.from({ length: 20 }, () => second());

  equal(JSON.stringify(valuesA), JSON.stringify(valuesB), '相同种子必须产生相同随机序列');
  assert(JSON.stringify(valuesA) !== JSON.stringify(valuesC), '不同种子应产生不同随机序列');
  assert(valuesA.every((value) => value >= 0 && value < 1), '随机值必须落在 [0,1) 范围内');
});
