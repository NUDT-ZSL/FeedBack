/**
 * 浑仪标准部件配置：三层嵌套（六合仪 → 三辰仪 → 四游仪），共 7 个可拆部件。
 * detachAfter 表达“从外到内”的拆装约束：外层未拆，内层不可拆。
 */
import type { AssemblyConfig } from './types.ts';

export const ARMILLARY_CONFIG: AssemblyConfig = {
  parts: [
    { id: 'liuhe-ziwu', name: '六合仪·子午环', layer: '六合仪', detachAfter: [] },
    { id: 'liuhe-east', name: '六合仪·东赤道环', layer: '六合仪', detachAfter: ['liuhe-ziwu'] },
    { id: 'liuhe-west', name: '六合仪·西赤道环', layer: '六合仪', detachAfter: ['liuhe-ziwu'] },
    {
      id: 'sanchen-chijing',
      name: '三辰仪·赤经环',
      layer: '三辰仪',
      detachAfter: ['liuhe-east', 'liuhe-west'],
    },
    {
      id: 'sanchen-huangjing',
      name: '三辰仪·黄经环',
      layer: '三辰仪',
      detachAfter: ['liuhe-east', 'liuhe-west'],
    },
    {
      id: 'sanchen-globe',
      name: '三辰仪·内球',
      layer: '三辰仪',
      detachAfter: ['sanchen-chijing', 'sanchen-huangjing'],
    },
    { id: 'siyou-shuanghuan', name: '四游仪·双环', layer: '四游仪', detachAfter: ['sanchen-globe'] },
  ],
};
