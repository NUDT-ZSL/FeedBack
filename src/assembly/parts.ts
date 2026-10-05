/**
 * 浑仪七个部件及其拆解依赖（dependsOn = 拆解本部件前必须先拆下的部件）。
 * 拆装顺序口径（从外到内：六合仪 -> 三辰仪 -> 四游仪）只在此处声明一次，
 * 界面、提示、进度结论均由状态机从该定义推导。
 */
import type { PartSpec } from './types.ts';

export const ARMILLARY_PARTS: PartSpec[] = [
  { id: 'liuhe_outer', name: '六合仪外环（子午环）', layer: '六合仪', dependsOn: [] },
  { id: 'liuhe_inner_east', name: '六合仪东赤道环', layer: '六合仪', dependsOn: ['liuhe_outer'] },
  { id: 'liuhe_inner_west', name: '六合仪西赤道环', layer: '六合仪', dependsOn: ['liuhe_outer'] },
  {
    id: 'sanchen_mid_a',
    name: '三辰仪中环（黄道环）',
    layer: '三辰仪',
    dependsOn: ['liuhe_inner_east', 'liuhe_inner_west'],
  },
  {
    id: 'sanchen_mid_b',
    name: '三辰仪中环（白道环）',
    layer: '三辰仪',
    dependsOn: ['liuhe_inner_east', 'liuhe_inner_west'],
  },
  {
    id: 'sanchen_core',
    name: '三辰仪内球（天球）',
    layer: '三辰仪',
    dependsOn: ['sanchen_mid_a', 'sanchen_mid_b'],
  },
  {
    id: 'siyou_double',
    name: '四游仪双环',
    layer: '四游仪',
    dependsOn: ['sanchen_core'],
  },
];

/** 标准拆装教学顺序：正向拆解 + 逆向装回 */
export const STANDARD_SEQUENCE: Array<{ type: 'disassemble' | 'assemble'; partId: string }> = [
  ...ARMILLARY_PARTS.map((part) => ({ type: 'disassemble' as const, partId: part.id })),
  ...[...ARMILLARY_PARTS].reverse().map((part) => ({ type: 'assemble' as const, partId: part.id })),
];
