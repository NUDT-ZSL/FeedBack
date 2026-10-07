import type { PaperRecipe } from '@/core/types';
import type { DrawOp } from '@/core/displayList';
import { defaultRecipe } from '@/core/recipe';

export function richRecipe(overrides: Partial<PaperRecipe> = {}): PaperRecipe {
  return {
    ...defaultRecipe(),
    patterns: [
      { id: 'a', type: 'plum', order: 0, scale: 1.4, position: { x: 30, y: 30 }, rotation: 0, opacity: 0.45 },
      { id: 'b', type: 'bamboo', order: 1, scale: 1, position: { x: 70, y: 60 }, rotation: 45, opacity: 0.5 },
      { id: 'c', type: 'ice', order: 1, scale: 0.8, position: { x: 50, y: 80 }, rotation: 30, opacity: 0.35 },
    ],
    goldFoil: { density: 50 },
    inscription: {
      text: '风花雪月',
      layout: 'vertical',
      position: { x: 50, y: 30 },
      fontSize: 24,
      color: '#3e2723',
    },
    ...overrides,
  };
}

export function withGoldDensity(recipe: PaperRecipe, density: number): PaperRecipe {
  return { ...recipe, goldFoil: { density } };
}

/** 递归收集显示列表中出现的指令类型 */
export function opKinds(ops: readonly unknown[]): Set<string> {
  const kinds = new Set<string>();
  const walk = (list: readonly DrawOp[]) => {
    for (const op of list) {
      kinds.add(op.kind);
      if (op.kind === 'group' || op.kind === 'clip') walk(op.ops);
    }
  };
  walk(ops as readonly DrawOp[]);
  return kinds;
}
