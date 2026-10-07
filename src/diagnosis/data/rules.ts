/**
 * 固定推演数据：证候规则、体质/病史修正、方剂库、药材。
 * 全部为本地静态数据，离线可用；任何推演只读这些数据，保证可复现。
 */

/** 证候规则：由四诊证据加权得出，并声明对体质/病史/其他证候的依赖。 */
export interface SyndromeRule {
  id: string;
  name: string;
  threshold: number;
  /** 证据权重：key 为采集项（symptom:xxx / pulse:xxx / tongue:xxx）。 */
  evidenceWeights: Record<string, number>;
  /** 体质/病史修正：id 为体质或病史项（constitution:xxx / history:xxx）。 */
  modifiers: Record<string, { delta: number; reason: string }>;
  /**
   * 依赖的其他证候 id：本证候需要在这些证候判定之后评估，
   * 其得分会加上被依赖证候成立时的传导分。
   */
  dependsOn: Record<string, number>;
}

export const SYNDROME_RULES: SyndromeRule[] = [
  {
    id: 'waigan-fenghan',
    name: '外感风寒',
    threshold: 6,
    evidenceWeights: {
      'symptom:fever': 2,
      'symptom:headache': 2,
      'symptom:aversion-cold': 3,
      'pulse:floating': 2,
      'pulse:tight': 2,
      'tongue:thin-white': 2,
    },
    modifiers: {
      'constitution:yangxu': { delta: 2, reason: '阳虚体质易感风寒' },
      'history:feiji': { delta: 1, reason: '素有肺疾，卫外不固' },
    },
    dependsOn: {},
  },
  {
    id: 'waigan-fengre',
    name: '外感风热',
    threshold: 6,
    evidenceWeights: {
      'symptom:fever': 3,
      'symptom:sore-throat': 3,
      'symptom:cough': 2,
      'pulse:floating': 1,
      'pulse:rapid': 2,
      'tongue:thin-yellow': 2,
    },
    modifiers: {
      'constitution:yinxu': { delta: 2, reason: '阴虚体质易化热' },
    },
    dependsOn: {},
  },
  {
    id: 'piwei-shire',
    name: '脾胃湿热',
    threshold: 6,
    evidenceWeights: {
      'symptom:stomachache': 2,
      'symptom:constipation': 2,
      'symptom:bad-breath': 2,
      'tongue:yellow-greasy': 3,
      'pulse:slippery': 2,
      'pulse:rapid': 1,
    },
    modifiers: {
      'constitution:tanshi': { delta: 2, reason: '痰湿体质易蕴湿热' },
      'history:weiji': { delta: 1, reason: '素有胃疾，运化失司' },
    },
    dependsOn: {},
  },
  {
    id: 'ganyu-qizhi',
    name: '肝郁气滞',
    threshold: 6,
    evidenceWeights: {
      'symptom:insomnia': 2,
      'symptom:chest-tightness': 3,
      'symptom:irritability': 3,
      'pulse:wiry': 3,
    },
    modifiers: {
      'constitution:qiyu': { delta: 2, reason: '气郁体质加重肝郁' },
    },
    dependsOn: {},
  },
  {
    id: 'feiqi-kuisun',
    name: '肺气亏虚',
    threshold: 5,
    evidenceWeights: {
      'symptom:cough': 2,
      'symptom:short-breath': 3,
      'pulse:weak': 3,
      'tongue:pale': 2,
    },
    modifiers: {
      'history:feiji': { delta: 2, reason: '既往肺疾耗伤肺气' },
      'constitution:qixu': { delta: 2, reason: '气虚体质肺气更亏' },
    },
    dependsOn: {},
  },
  {
    id: 'feire-yongfei',
    name: '肺热壅肺',
    threshold: 6,
    evidenceWeights: {
      'symptom:cough': 2,
      'symptom:fever': 2,
      'symptom:yellow-phlegm': 3,
      'pulse:rapid': 2,
      'tongue:yellow-greasy': 2,
    },
    modifiers: {
      'constitution:yinxu': { delta: 1, reason: '阴虚易生内热' },
    },
    // 肺热可由外感风热入里化热而来：构成一条跨证候依赖。
    dependsOn: { 'waigan-fengre': 2 },
  },
];

/** 体质/病史 -> 证候 的反向影响（证候成立反过来修正体质评估强度）。 */
export interface ConstitutionFeedback {
  constitutionId: string;
  /** 当所列证候成立时，该体质在疗效预估中的相合度修正。 */
  whenSyndrome: Record<string, number>;
}

export const CONSTITUTION_FEEDBACK: ConstitutionFeedback[] = [
  { constitutionId: 'constitution:yangxu', whenSyndrome: { 'waigan-fenghan': -5 } },
  { constitutionId: 'constitution:tanshi', whenSyndrome: { 'piwei-shire': -5 } },
  { constitutionId: 'constitution:qixu', whenSyndrome: { 'feiqi-kuisun': -8 } },
];

export interface HerbDef {
  id: string;
  name: string;
  /** 寒热值：-3 大寒 .. +3 大热。 */
  nature: number;
  baseGrams: number;
}

export const HERBS: Record<string, HerbDef> = {
  guizhi: { id: 'guizhi', name: '桂枝', nature: 2, baseGrams: 9 },
  baishao: { id: 'baishao', name: '白芍', nature: -1, baseGrams: 9 },
  shengjiang: { id: 'shengjiang', name: '生姜', nature: 2, baseGrams: 6 },
  dazao: { id: 'dazao', name: '大枣', nature: 1, baseGrams: 6 },
  gancao: { id: 'gancao', name: '甘草', nature: 0, baseGrams: 6 },
  jinyinhua: { id: 'jinyinhua', name: '金银花', nature: -2, baseGrams: 12 },
  lianqiao: { id: 'lianqiao', name: '连翘', nature: -2, baseGrams: 9 },
  bohe: { id: 'bohe', name: '薄荷', nature: -1, baseGrams: 6 },
  huanglian: { id: 'huanglian', name: '黄连', nature: -3, baseGrams: 3 },
  huangqin: { id: 'huangqin', name: '黄芩', nature: -2, baseGrams: 9 },
  banxia: { id: 'banxia', name: '半夏', nature: 1, baseGrams: 9 },
  chenpi: { id: 'chenpi', name: '陈皮', nature: 1, baseGrams: 6 },
  chaihu: { id: 'chaihu', name: '柴胡', nature: -1, baseGrams: 9 },
  xiangfu: { id: 'xiangfu', name: '香附', nature: 0, baseGrams: 9 },
  chuanxiong: { id: 'chuanxiong', name: '川芎', nature: 1, baseGrams: 6 },
  renshen: { id: 'renshen', name: '人参', nature: 1, baseGrams: 6 },
  huangqi: { id: 'huangqi', name: '黄芪', nature: 1, baseGrams: 12 },
  baizhu: { id: 'baizhu', name: '白术', nature: 1, baseGrams: 9 },
  jiegeng: { id: 'jiegeng', name: '桔梗', nature: 0, baseGrams: 6 },
  shigao: { id: 'shigao', name: '石膏', nature: -3, baseGrams: 15 },
  zhimu: { id: 'zhimu', name: '知母', nature: -2, baseGrams: 9 },
};

export interface FormulaDef {
  id: string;
  name: string;
  /** 主治证候及每证的匹配分。 */
  indications: Record<string, number>;
  /** 禁忌：病史/体质项，命中则扣分并提示。 */
  contraindications: Record<string, { penalty: number; note: string }>;
  /** 组成：药材 -> 君臣佐使。 */
  composition: { herbId: string; role: 'jun' | 'chen' | 'zuo' | 'shi' }[];
  /** 基础疗程（剂）。 */
  baseCourses: number;
}

export const FORMULAS: FormulaDef[] = [
  {
    id: 'guizhi-tang',
    name: '桂枝汤',
    indications: { 'waigan-fenghan': 10 },
    contraindications: {
      'constitution:yinxu': { penalty: 4, note: '阴虚内热者慎用辛温' },
    },
    composition: [
      { herbId: 'guizhi', role: 'jun' },
      { herbId: 'baishao', role: 'chen' },
      { herbId: 'shengjiang', role: 'zuo' },
      { herbId: 'dazao', role: 'zuo' },
      { herbId: 'gancao', role: 'shi' },
    ],
    baseCourses: 3,
  },
  {
    id: 'yinqiao-san',
    name: '银翘散',
    indications: { 'waigan-fengre': 10, 'feire-yongfei': 4 },
    contraindications: {
      'constitution:yangxu': { penalty: 4, note: '阳虚者慎用寒凉' },
    },
    composition: [
      { herbId: 'jinyinhua', role: 'jun' },
      { herbId: 'lianqiao', role: 'chen' },
      { herbId: 'bohe', role: 'zuo' },
      { herbId: 'jiegeng', role: 'shi' },
    ],
    baseCourses: 3,
  },
  {
    id: 'lianpo-yin',
    name: '连朴饮',
    indications: { 'piwei-shire': 10 },
    contraindications: {
      'history:weiji': { penalty: 2, note: '胃疾久病者苦寒减量' },
    },
    composition: [
      { herbId: 'huanglian', role: 'jun' },
      { herbId: 'huangqin', role: 'chen' },
      { herbId: 'banxia', role: 'zuo' },
      { herbId: 'chenpi', role: 'shi' },
    ],
    baseCourses: 5,
  },
  {
    id: 'chaihu-shugan-san',
    name: '柴胡疏肝散',
    indications: { 'ganyu-qizhi': 10 },
    contraindications: {},
    composition: [
      { herbId: 'chaihu', role: 'jun' },
      { herbId: 'xiangfu', role: 'chen' },
      { herbId: 'chuanxiong', role: 'zuo' },
      { herbId: 'baishao', role: 'zuo' },
      { herbId: 'gancao', role: 'shi' },
    ],
    baseCourses: 5,
  },
  {
    id: 'buzhong-yiqi-jian',
    name: '补肺益气煎',
    indications: { 'feiqi-kuisun': 10 },
    contraindications: {
      'constitution:yinxu': { penalty: 3, note: '阴虚燥咳者不宜温补' },
    },
    composition: [
      { herbId: 'huangqi', role: 'jun' },
      { herbId: 'renshen', role: 'chen' },
      { herbId: 'baizhu', role: 'zuo' },
      { herbId: 'gancao', role: 'shi' },
    ],
    baseCourses: 7,
  },
  {
    id: 'baihu-jian',
    name: '白虎清金煎',
    indications: { 'feire-yongfei': 10, 'waigan-fengre': 3 },
    contraindications: {
      'constitution:yangxu': { penalty: 5, note: '阳虚者忌大寒之剂' },
      'history:weiji': { penalty: 2, note: '胃弱者石膏减量' },
    },
    composition: [
      { herbId: 'shigao', role: 'jun' },
      { herbId: 'zhimu', role: 'chen' },
      { herbId: 'huangqin', role: 'zuo' },
      { herbId: 'gancao', role: 'shi' },
    ],
    baseCourses: 4,
  },
];

/** 体质对剂量的修正系数（乘性）。 */
export const CONSTITUTION_DOSAGE_FACTOR: Record<string, { factor: number; note: string }> = {
  'constitution:qixu': { factor: 0.9, note: '气虚体质，药量稍减以缓图' },
  'constitution:yangxu': { factor: 0.9, note: '阳虚体质，减量防伤正' },
  'constitution:tanshi': { factor: 1.1, note: '痰湿体质，稍加量以助化湿' },
};

/** 病史对特定寒热偏向药材的剂量修正。 */
export const HISTORY_DOSAGE_FACTOR: Record<
  string,
  { natureSign: 'cold' | 'hot'; factor: number; note: string }
> = {
  'history:weiji': { natureSign: 'cold', factor: 0.8, note: '素有胃疾，寒凉药减量' },
  'history:feiji': { natureSign: 'hot', factor: 0.9, note: '素有肺疾，温热药稍减' },
};
