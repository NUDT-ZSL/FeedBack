/**
 * 问诊室可采集项目录：仅负责展示文案与分组，推演规则全部在 src/diagnosis 中。
 */
import type { ExamSource, RecordKind } from '@/diagnosis';

export interface CatalogItem {
  kind: RecordKind;
  key: string;
  label: string;
}

export interface SourceGroup {
  source: ExamSource;
  title: string;
  subtitle: string;
  items: CatalogItem[];
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    source: 'wang',
    title: '望诊',
    subtitle: '观舌苔、察痰色',
    items: [
      { kind: 'tongue', key: 'thin-white', label: '薄白苔' },
      { kind: 'tongue', key: 'thin-yellow', label: '薄黄苔' },
      { kind: 'tongue', key: 'yellow-greasy', label: '黄腻苔' },
      { kind: 'tongue', key: 'pale', label: '舌淡' },
      { kind: 'symptom', key: 'yellow-phlegm', label: '痰黄稠' },
    ],
  },
  {
    source: 'wen',
    title: '闻诊',
    subtitle: '听声息、嗅气味',
    items: [
      { kind: 'symptom', key: 'cough', label: '咳嗽' },
      { kind: 'symptom', key: 'short-breath', label: '气短' },
      { kind: 'symptom', key: 'bad-breath', label: '口臭' },
    ],
  },
  {
    source: 'wenwen',
    title: '问诊',
    subtitle: '问寒热、问二便、问旧疾',
    items: [
      { kind: 'symptom', key: 'fever', label: '发热' },
      { kind: 'symptom', key: 'aversion-cold', label: '恶寒' },
      { kind: 'symptom', key: 'headache', label: '头痛' },
      { kind: 'symptom', key: 'sore-throat', label: '咽痛' },
      { kind: 'symptom', key: 'stomachache', label: '胃脘痛' },
      { kind: 'symptom', key: 'constipation', label: '便秘' },
      { kind: 'symptom', key: 'insomnia', label: '失眠' },
      { kind: 'symptom', key: 'chest-tightness', label: '胸闷' },
      { kind: 'symptom', key: 'irritability', label: '烦躁易怒' },
      { kind: 'constitution', key: 'yangxu', label: '体质·阳虚' },
      { kind: 'constitution', key: 'yinxu', label: '体质·阴虚' },
      { kind: 'constitution', key: 'qixu', label: '体质·气虚' },
      { kind: 'constitution', key: 'tanshi', label: '体质·痰湿' },
      { kind: 'constitution', key: 'qiyu', label: '体质·气郁' },
      { kind: 'history', key: 'feiji', label: '旧疾·肺疾' },
      { kind: 'history', key: 'weiji', label: '旧疾·胃疾' },
    ],
  },
  {
    source: 'qie',
    title: '切诊',
    subtitle: '按脉象',
    items: [
      { kind: 'pulse', key: 'floating', label: '浮脉' },
      { kind: 'pulse', key: 'tight', label: '紧脉' },
      { kind: 'pulse', key: 'rapid', label: '数脉' },
      { kind: 'pulse', key: 'slippery', label: '滑脉' },
      { kind: 'pulse', key: 'wiry', label: '弦脉' },
      { kind: 'pulse', key: 'weak', label: '弱脉' },
    ],
  },
];

export const SOURCE_LABEL: Record<ExamSource, string> = {
  wang: '望',
  wen: '闻',
  wenwen: '问',
  qie: '切',
};

export const KIND_LABEL: Record<RecordKind, string> = {
  symptom: '症状',
  pulse: '脉象',
  tongue: '舌苔',
  constitution: '体质',
  history: '旧疾',
};

const itemLabelMap = new Map<string, string>();
for (const group of SOURCE_GROUPS) {
  for (const item of group.items) {
    itemLabelMap.set(`${item.kind}:${item.key}`, item.label);
  }
}

export function itemLabel(kind: RecordKind, key: string): string {
  return itemLabelMap.get(`${kind}:${key}`) ?? `${KIND_LABEL[kind]}·${key}`;
}
