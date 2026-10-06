/**
 * 固定知识库：证候权重、体质/病史影响规则、方剂与剂量、疗效回推参数。
 *
 * 所有规则显式声明依赖（dependsOn），形如 "syndrome:wind-cold"。
 * 体质、既往病史与证候判定之间的相互影响通过 ModifierRule 建模：
 * 规则本身既依赖触发它的体质/病史记录，也可以依赖某证候的判定结果，
 * 因此数据配置出错时可能形成依赖闭环或指向缺失，由 graph 层显式检出。
 */
import type { HerbRole, ObservationKind } from './types.js';

export interface SyndromeRule {
  id: string;
  name: string;
  /** 成立阈值，分值达到该值才判定为该证候 */
  threshold: number;
  symptomWeights: Record<string, number>;
  pulseWeights: Record<string, number>;
  tongueWeights: Record<string, number>;
}

/**
 * 体质 / 既往病史 → 证候加减分规则。
 * dependsOn 中引用 "syndrome:<id>" 表示该加减分还要参考另一证候的判定，
 * 用于表达「体质、病史与证候互相影响」。
 */
export interface ModifierRule {
  id: string;
  triggerKind: Extract<ObservationKind, 'constitution' | 'history'>;
  triggerValue: string;
  /** 作用的目标证候 id */
  syndrome: string;
  delta: number;
  dependsOn: string[];
  description: string;
}

export interface FormulaDef {
  id: string;
  name: string;
  /** 主治证候 id 列表 */
  syndromes: string[];
  herbs: { name: string; role: HerbRole; dose: number }[];
  baseEfficacy: number;
  /** 与体质、病史不合时的说明 */
  cautions: string[];
}

export interface KnowledgeBase {
  syndromes: SyndromeRule[];
  modifiers: ModifierRule[];
  formulas: FormulaDef[];
  /** 体质对疗效的修正：体质值 → 加减百分点 */
  efficacyByConstitution: Record<string, number>;
  /** 既往病史对疗效的修正与取效日数影响 */
  efficacyByHistory: Record<string, { rateDelta: number; onsetDeltaDays: number }>;
}

export const SYMPTOMS: { id: string; name: string }[] = [
  { id: 'aversion-cold', name: '恶寒' },
  { id: 'headache', name: '头痛' },
  { id: 'fever', name: '发热' },
  { id: 'sweating', name: '有汗' },
  { id: 'cough', name: '咳嗽' },
  { id: 'stomachache', name: '胃痛' },
  { id: 'poor-appetite', name: '纳呆' },
  { id: 'phlegm', name: '痰多' },
  { id: 'constipation', name: '便秘' },
  { id: 'thirst', name: '口渴' },
  { id: 'fatigue', name: '乏力' },
  { id: 'insomnia', name: '失眠' },
];

export const PULSES = ['浮脉', '沉脉', '迟脉', '数脉', '滑脉', '弦脉'] as const;
export const TONGUES = ['白苔', '黄苔', '薄苔', '腻苔'] as const;
export const CONSTITUTIONS = ['平和质', '气虚质', '阳虚质', '阴虚质', '湿热质'] as const;
export const HISTORIES = ['无', '脾胃虚寒', '消渴', '喘证', '郁证'] as const;

export const DEFAULT_KNOWLEDGE: KnowledgeBase = {
  syndromes: [
    {
      id: 'wind-cold',
      name: '外感风寒',
      threshold: 20,
      symptomWeights: {
        'aversion-cold': 10,
        headache: 7,
        fever: 5,
        sweating: 4,
        cough: 3,
      },
      pulseWeights: { 浮脉: 9, 迟脉: 4 },
      tongueWeights: { 薄苔: 5, 白苔: 4 },
    },
    {
      id: 'wind-heat',
      name: '外感风热',
      threshold: 20,
      symptomWeights: { fever: 10, thirst: 7, headache: 5, cough: 4 },
      pulseWeights: { 数脉: 9, 浮脉: 3 },
      tongueWeights: { 黄苔: 8, 薄苔: 2 },
    },
    {
      id: 'spleen-damp-heat',
      name: '脾胃湿热',
      threshold: 20,
      symptomWeights: {
        stomachache: 9,
        'poor-appetite': 7,
        phlegm: 5,
        constipation: 4,
      },
      pulseWeights: { 滑脉: 8, 数脉: 4 },
      tongueWeights: { 腻苔: 9, 黄苔: 6 },
    },
    {
      id: 'liver-qi-stagnation',
      name: '肝郁气滞',
      threshold: 20,
      symptomWeights: { stomachache: 6, headache: 5, insomnia: 6, fatigue: 3 },
      pulseWeights: { 弦脉: 10 },
      tongueWeights: { 薄苔: 3, 白苔: 2 },
    },
    {
      id: 'qi-blood-deficiency',
      name: '气血两虚',
      threshold: 20,
      symptomWeights: { fatigue: 10, insomnia: 6, headache: 4, 'poor-appetite': 5 },
      pulseWeights: { 沉脉: 7, 迟脉: 4 },
      tongueWeights: { 白苔: 4, 薄苔: 3 },
    },
    {
      id: 'phlegm-damp',
      name: '痰湿内阻',
      threshold: 20,
      symptomWeights: { phlegm: 10, cough: 6, 'poor-appetite': 5, stomachache: 3 },
      pulseWeights: { 滑脉: 7, 沉脉: 3 },
      tongueWeights: { 腻苔: 9, 白苔: 3 },
    },
  ],

  modifiers: [
    {
      id: 'mod-yangxu-windcold',
      triggerKind: 'constitution',
      triggerValue: '阳虚质',
      syndrome: 'wind-cold',
      delta: 8,
      dependsOn: [],
      description: '阳虚之体感寒更易成外感风寒',
    },
    {
      id: 'mod-qixu-deficiency',
      triggerKind: 'constitution',
      triggerValue: '气虚质',
      syndrome: 'qi-blood-deficiency',
      delta: 10,
      dependsOn: [],
      description: '气虚质加重气血两虚倾向',
    },
    {
      id: 'mod-yinxu-windheat',
      triggerKind: 'constitution',
      triggerValue: '阴虚质',
      syndrome: 'wind-heat',
      delta: 7,
      dependsOn: [],
      description: '阴虚体质易从热化',
    },
    {
      id: 'mod-shire-dampheat',
      triggerKind: 'constitution',
      triggerValue: '湿热质',
      syndrome: 'spleen-damp-heat',
      delta: 10,
      dependsOn: ['syndrome:phlegm-damp'],
      description: '湿热质叠加痰湿表现时，湿热内蕴更甚',
    },
    {
      id: 'mod-pixuhan-dampheat',
      triggerKind: 'history',
      triggerValue: '脾胃虚寒',
      syndrome: 'spleen-damp-heat',
      delta: -6,
      dependsOn: [],
      description: '素体脾胃虚寒者，纯实热证判定需谨慎',
    },
    {
      id: 'mod-chuanzheng-windcold',
      triggerKind: 'history',
      triggerValue: '喘证',
      syndrome: 'wind-cold',
      delta: 4,
      dependsOn: [],
      description: '素有喘证，感寒易引动伏邪',
    },
    {
      id: 'mod-yuzheng-liver',
      triggerKind: 'history',
      triggerValue: '郁证',
      syndrome: 'liver-qi-stagnation',
      delta: 9,
      dependsOn: [],
      description: '郁证病史强化肝郁气滞判定',
    },
    {
      id: 'mod-xiaoke-deficiency',
      triggerKind: 'history',
      triggerValue: '消渴',
      syndrome: 'qi-blood-deficiency',
      delta: 6,
      dependsOn: ['syndrome:phlegm-damp'],
      description: '消渴久病兼痰湿者，须兼顾虚损',
    },
  ],

  formulas: [
    {
      id: 'guizhi-tang',
      name: '桂枝汤',
      syndromes: ['wind-cold'],
      herbs: [
        { name: '桂枝', role: '君', dose: 9 },
        { name: '芍药', role: '臣', dose: 9 },
        { name: '生姜', role: '佐', dose: 9 },
        { name: '大枣', role: '佐', dose: 6 },
        { name: '炙甘草', role: '使', dose: 6 },
      ],
      baseEfficacy: 78,
      cautions: ['阴虚火旺者慎用'],
    },
    {
      id: 'mahuang-tang',
      name: '麻黄汤',
      syndromes: ['wind-cold'],
      herbs: [
        { name: '麻黄', role: '君', dose: 9 },
        { name: '桂枝', role: '臣', dose: 6 },
        { name: '杏仁', role: '佐', dose: 9 },
        { name: '炙甘草', role: '使', dose: 3 },
      ],
      baseEfficacy: 74,
      cautions: ['有汗者慎用'],
    },
    {
      id: 'yinqiao-san',
      name: '银翘散',
      syndromes: ['wind-heat'],
      herbs: [
        { name: '金银花', role: '君', dose: 9 },
        { name: '连翘', role: '君', dose: 9 },
        { name: '薄荷', role: '臣', dose: 6 },
        { name: '牛蒡子', role: '臣', dose: 9 },
        { name: '桔梗', role: '佐', dose: 6 },
        { name: '甘草', role: '使', dose: 3 },
      ],
      baseEfficacy: 80,
      cautions: [],
    },
    {
      id: 'pingwei-san',
      name: '平胃散',
      syndromes: ['spleen-damp-heat'],
      herbs: [
        { name: '苍术', role: '君', dose: 12 },
        { name: '厚朴', role: '臣', dose: 9 },
        { name: '陈皮', role: '佐', dose: 9 },
        { name: '炙甘草', role: '使', dose: 3 },
      ],
      baseEfficacy: 72,
      cautions: ['脾胃虚寒者减量'],
    },
    {
      id: 'xiaoyao-san',
      name: '逍遥散',
      syndromes: ['liver-qi-stagnation'],
      herbs: [
        { name: '柴胡', role: '君', dose: 9 },
        { name: '当归', role: '臣', dose: 9 },
        { name: '白芍', role: '臣', dose: 9 },
        { name: '白术', role: '佐', dose: 9 },
        { name: '茯苓', role: '佐', dose: 9 },
        { name: '薄荷', role: '使', dose: 3 },
        { name: '生姜', role: '使', dose: 3 },
        { name: '炙甘草', role: '使', dose: 6 },
      ],
      baseEfficacy: 76,
      cautions: [],
    },
    {
      id: 'bazhen-tang',
      name: '八珍汤',
      syndromes: ['qi-blood-deficiency'],
      herbs: [
        { name: '人参', role: '君', dose: 9 },
        { name: '熟地黄', role: '君', dose: 12 },
        { name: '白术', role: '臣', dose: 9 },
        { name: '当归', role: '臣', dose: 9 },
        { name: '茯苓', role: '佐', dose: 9 },
        { name: '白芍', role: '佐', dose: 9 },
        { name: '川芎', role: '佐', dose: 6 },
        { name: '炙甘草', role: '使', dose: 6 },
      ],
      baseEfficacy: 75,
      cautions: [],
    },
    {
      id: 'erchen-tang',
      name: '二陈汤',
      syndromes: ['phlegm-damp'],
      herbs: [
        { name: '半夏', role: '君', dose: 9 },
        { name: '陈皮', role: '臣', dose: 9 },
        { name: '茯苓', role: '佐', dose: 9 },
        { name: '生姜', role: '佐', dose: 6 },
        { name: '炙甘草', role: '使', dose: 3 },
      ],
      baseEfficacy: 73,
      cautions: ['阴虚燥咳者慎用'],
    },
  ],

  efficacyByConstitution: {
    平和质: 2,
    气虚质: -2,
    阳虚质: -4,
    阴虚质: -3,
    湿热质: -1,
  },
  efficacyByHistory: {
    无: { rateDelta: 0, onsetDeltaDays: 0 },
    脾胃虚寒: { rateDelta: -4, onsetDeltaDays: 1 },
    消渴: { rateDelta: -6, onsetDeltaDays: 2 },
    喘证: { rateDelta: -3, onsetDeltaDays: 1 },
    郁证: { rateDelta: -2, onsetDeltaDays: 1 },
  },
};
