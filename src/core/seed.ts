/**
 * 预置示例数据：三场宴席，覆盖「已编排」「含冲突待处理」「空名单」三种状态。
 */
import type { Banquet, Workspace } from './types';
import { emptyArrangement } from './types';
import { fullRearrange } from './rearrange';

const g = (
  id: string,
  name: string,
  rank: 1 | 2 | 3 | 4 | 5,
  dietary: string[] = [],
  entourage = 0,
) => ({ id, name, rank, dietary, entourage });

function springBanquet(): Banquet {
  const dishes = [
    { id: 'd_s1', name: '清蒸鲈鱼', tags: ['河鲜'] },
    { id: 'd_s2', name: '花生酪', tags: ['花生', '坚果'] },
    { id: 'd_s3', name: '葱爆羊肉', tags: ['牛羊肉'] },
    { id: 'd_s4', name: '素炒时蔬', tags: ['素'] },
    { id: 'd_s5', name: '蟹粉豆腐', tags: ['海鲜'] },
  ];
  const banquet: Banquet = {
    id: 'bq_spring',
    name: '春日雅集',
    createdAt: Date.now(),
    guests: [
      g('g_s1', '沈尚书', 5, [], 1),
      g('g_s2', '顾侍郎', 4, ['海鲜'], 0),
      g('g_s3', '陆翰林', 4, [], 2),
      g('g_s4', '苏掌柜', 3, ['花生'], 1),
      g('g_s5', '周先生', 3, [], 0),
      g('g_s6', '赵镖头', 2, ['牛羊肉'], 0),
      g('g_s7', '小钱', 1, [], 0),
    ],
    tables: [
      { id: 't_s1', name: '主桌', capacity: 6, isMain: true, minRank: 4, dishIds: ['d_s1', 'd_s3', 'd_s4'] },
      { id: 't_s2', name: '东厢桌', capacity: 5, isMain: false, minRank: 1, dishIds: ['d_s2', 'd_s4'] },
      { id: 't_s3', name: '西厢桌', capacity: 4, isMain: false, minRank: 1, dishIds: ['d_s3', 'd_s5'] },
    ],
    dishes,
    constraints: [
      { id: 'c_s1', a: 'g_s4', b: 'g_s6', note: '商队旧怨' },
    ],
    arrangement: emptyArrangement(),
    lastArchived: null,
  };
  const result = fullRearrange(banquet);
  return { ...banquet, arrangement: result.arrangement };
}

function autumnBanquet(): Banquet {
  const banquet: Banquet = {
    id: 'bq_autumn',
    name: '中秋夜宴',
    createdAt: Date.now(),
    guests: [
      g('g_a1', '甲公子', 4, [], 0),
      g('g_a2', '乙员外', 4, [], 0),
      g('g_a3', '丙先生', 4, [], 0),
      g('g_a4', '丁学士', 3, [], 1),
    ],
    tables: [
      { id: 't_a1', name: '主桌', capacity: 3, isMain: true, minRank: 4, dishIds: [] },
      { id: 't_a2', name: '次桌', capacity: 2, isMain: false, minRank: 1, dishIds: [] },
    ],
    dishes: [{ id: 'd_a1', name: '月饼', tags: ['坚果'] }],
    constraints: [
      { id: 'c_a1', a: 'g_a1', b: 'g_a2', note: '甲忌与乙同桌' },
      { id: 'c_a2', a: 'g_a2', b: 'g_a3', note: '乙忌与丙同桌' },
      { id: 'c_a3', a: 'g_a3', b: 'g_a1', note: '丙忌与甲同桌' },
    ],
    arrangement: emptyArrangement(),
    lastArchived: null,
  };
  const result = fullRearrange(banquet);
  return { ...banquet, arrangement: result.arrangement };
}

function emptyBanquet(): Banquet {
  return {
    id: 'bq_winter',
    name: '冬至家宴（筹备中）',
    createdAt: Date.now(),
    guests: [],
    tables: [
      { id: 't_w1', name: '主桌', capacity: 8, isMain: true, minRank: 4, dishIds: [] },
    ],
    dishes: [],
    constraints: [],
    arrangement: emptyArrangement(),
    lastArchived: null,
  };
}

export function createSeedWorkspace(): Workspace {
  return {
    version: 1,
    banquets: [springBanquet(), autumnBanquet(), emptyBanquet()],
    activeBanquetId: 'bq_spring',
  };
}
