import { suite, test, assert, assertEqual, assertDeepEqual } from '../harness.ts';
import { allQuestions, selectRandomQuestions } from '../../shared/questions.ts';
import type { QuestionType } from '../../shared/types.ts';

const ALL_TYPES: QuestionType[] = ['preference', 'opinion', 'fact'];

suite('类别二：题目抽取可复现与题型覆盖', () => {
  test('相同种子抽题结果完全可复现', () => {
    const first = selectRandomQuestions(10, 42);
    const second = selectRandomQuestions(10, 42);
    assertDeepEqual(second, first, '相同种子的抽题结果必须完全一致');
    assertDeepEqual(
      second.map(q => q.id),
      first.map(q => q.id),
      '相同种子的题目顺序必须一致'
    );
  });

  test('不同种子产生不同的抽题序列', () => {
    const sequences = [1, 2, 3, 4, 5].map(seed => selectRandomQuestions(10, seed).map(q => q.id).join(','));
    const unique = new Set(sequences);
    assert(unique.size > 1, '不同种子应产生不同的题目顺序');
  });

  test('抽题数量正确且无重复题目', () => {
    for (const seed of [0, 1, 7, 123, 999999]) {
      const selected = selectRandomQuestions(10, seed);
      assertEqual(selected.length, 10, `种子 ${seed} 应抽出 10 道题`);
      const ids = new Set(selected.map(q => q.id));
      assertEqual(ids.size, 10, `种子 ${seed} 抽题不允许重复`);
      selected.forEach(q => {
        assert(allQuestions.some(source => source.id === q.id), `题目 ${q.id} 必须来自题库`);
      });
    }
  });

  test('给定种子的抽题覆盖全部题型', () => {
    for (const seed of [1, 2, 3, 42, 2026]) {
      const types = new Set(selectRandomQuestions(10, seed).map(q => q.type));
      ALL_TYPES.forEach(type => {
        assert(types.has(type), `种子 ${seed} 的抽题缺少题型 ${type}`);
      });
    }
  });

  test('不同种子的小批量抽题合集覆盖全部题型与题库', () => {
    const coveredTypes = new Set<QuestionType>();
    const coveredIds = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      selectRandomQuestions(4, seed).forEach(q => {
        coveredTypes.add(q.type);
        coveredIds.add(q.id);
      });
    }
    assertEqual(coveredTypes.size, ALL_TYPES.length, '小批量抽题合集必须覆盖全部题型');
    assertEqual(coveredIds.size, allQuestions.length, '小批量抽题合集必须覆盖整个题库');
  });

  test('不传种子时仍能正常抽题', () => {
    const selected = selectRandomQuestions(10);
    assertEqual(selected.length, 10, '默认抽题应为 10 道');
    assertEqual(new Set(selected.map(q => q.id)).size, 10, '默认抽题不允许重复');
  });
});
