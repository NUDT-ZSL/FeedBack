// UI 层类型与常量。推演相关类型统一从核心层 re-export，渲染层只消费这些类型。
export type {
  RingKey,
  RingAngles,
  OrbitalBodyParams,
  ObserverView,
  SimulationConfig,
  SimulationFrame,
  BodyPosition,
  BodyVisibility,
  OcclusionRelation,
  OcclusionEvidence,
  VisibilityState,
  TimeRange,
  BatchResult
} from './engine/index.ts';

export { RING_KEYS, RING_COLORS, RING_LABELS, DEFAULT_CONFIG } from './engine/index.ts';

export const PREDICTIONS = [
  '紫气东来',
  '荧惑守心',
  '七星连珠',
  '月晕而风',
  '北斗指路',
  '玄武当空'
] as const;

export const ZODIAC_SIGNS = [
  { name: '白羊', symbol: '♈', interpretation: '阳气初生，万物复苏，宜开拓进取' },
  { name: '金牛', symbol: '♉', interpretation: '土德厚载，财富积聚，宜守正持重' },
  { name: '双子', symbol: '♊', interpretation: '阴阳交泰，变化无常，宜随机应变' },
  { name: '巨蟹', symbol: '♋', interpretation: '水润万物，情感丰沛，宜修身养性' },
  { name: '狮子', symbol: '♌', interpretation: '火气正盛，威仪四方，宜彰显才华' },
  { name: '室女', symbol: '♍', interpretation: '金风送爽，收获在望，宜精益求精' },
  { name: '天秤', symbol: '♎', interpretation: '权衡轻重，公正平和，宜协调关系' },
  { name: '天蝎', symbol: '♏', interpretation: '深藏不露，蓄势待发，宜谋定后动' },
  { name: '射手', symbol: '♐', interpretation: '志存高远，一箭中的，宜远行求索' },
  { name: '摩羯', symbol: '♑', interpretation: '山岳稳重，厚德载物，宜脚踏实地' },
  { name: '宝瓶', symbol: '♒', interpretation: '智慧如水，润泽苍生，宜创新求变' },
  { name: '双鱼', symbol: '♓', interpretation: '阴阳相融，梦境成真，宜静心观想' }
] as const;

/** 推演时间轴范围（毫秒） */
export const TIMELINE = { start: 0, end: 120_000, step: 100 } as const;
