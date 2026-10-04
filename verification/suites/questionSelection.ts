import { allQuestions, selectQuestions, createSeededRandom } from '../../shared/questions';
import { Suite } from '../harness';

export function questionSelectionSuite(suite: Suite): void {
  const firstRun = selectQuestions(10, 123).map(q => q.id);
  const secondRun = selectQuestions(10, 123).map(q => q.id);
  suite.assertEqual('相同种子的抽题结果可复现', secondRun, firstRun);

  const randomA = createSeededRandom(999);
  const randomB = createSeededRandom(999);
  const sequenceA = Array.from({ length: 5 }, () => randomA());
  const sequenceB = Array.from({ length: 5 }, () => randomB());
  suite.assertEqual('相同种子的随机流完全一致', sequenceB, sequenceA);

  const otherSeed = selectQuestions(10, 456).map(q => q.id);
  suite.check('不同种子产生不同抽题顺序', JSON.stringify(otherSeed) !== JSON.stringify(firstRun));

  const bankIds = new Set(allQuestions.map(q => q.id));
  let allFromBank = true;
  let noDuplicates = true;
  const coveredTypes = new Set<string>();

  for (let seed = 1; seed <= 30; seed++) {
    const picked = selectQuestions(5, seed);
    const ids = picked.map(q => q.id);
    if (picked.some(q => !bankIds.has(q.id))) allFromBank = false;
    if (new Set(ids).size !== ids.length) noDuplicates = false;
    picked.forEach(q => coveredTypes.add(q.type));
  }

  suite.check('各种子下抽题均来自题库', allFromBank);
  suite.check('各种子下抽题无重复题目', noDuplicates);
  suite.assertEqual('不同种子累积覆盖全部题型', [...coveredTypes].sort(), ['fact', 'opinion', 'preference']);

  const full = selectQuestions(10, 42);
  suite.assertEqual(
    '抽取数量等于题库总量时覆盖全部题目',
    full.map(q => q.id).sort(),
    [...bankIds].sort()
  );
}
