import { EscapeRecord, FilterState, Stats, ThemeType } from '../types';

const initialRecords: EscapeRecord[] = [
  {
    id: '1',
    name: '幽魂旅馆',
    theme: '恐怖',
    storeName: '迷境密室体验馆',
    playerCount: 4,
    timeLimit: 90,
    actualTime: 78,
    escaped: true,
    teammates: [
      { id: 't1-1', name: '小明', role: '脑力', comment: '解谜超厉害' },
      { id: 't1-2', name: '小红', role: '侦察', comment: '眼神特别好' },
    ],
    createdAt: Date.now() - 86400000 * 7,
  },
  {
    id: '2',
    name: '深渊回响',
    theme: '科幻',
    storeName: '星际密室',
    playerCount: 3,
    timeLimit: 60,
    actualTime: 55,
    escaped: true,
    teammates: [
      { id: 't2-1', name: '阿强', role: '指挥', comment: '领导力满分' },
    ],
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: '3',
    name: '古宅迷踪',
    theme: '古风',
    storeName: '梦回千年',
    playerCount: 6,
    timeLimit: 120,
    actualTime: null,
    escaped: false,
    teammates: [
      { id: 't3-1', name: '小华', role: '体力', comment: '开锁小能手' },
      { id: 't3-2', name: '小李', role: '搞笑', comment: '气氛组担当' },
      { id: 't3-3', name: '阿花', role: '脑力', comment: '线索梳理专家' },
    ],
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: '4',
    name: '消失的证人',
    theme: '悬疑',
    storeName: '迷雾侦探社',
    playerCount: 2,
    timeLimit: 60,
    actualTime: 45,
    escaped: true,
    teammates: [
      { id: 't4-1', name: '老王', role: '侦察', comment: '细节控' },
    ],
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: '5',
    name: '疯狂实验室',
    theme: '搞笑',
    storeName: '欢乐逗密室',
    playerCount: 5,
    timeLimit: 75,
    actualTime: 68,
    escaped: true,
    teammates: [
      { id: 't5-1', name: '大壮', role: '体力', comment: '力气大到吓人' },
      { id: 't5-2', name: '小美', role: '搞笑', comment: '笑到肚子疼' },
    ],
    createdAt: Date.now() - 86400000 * 1,
  },
  {
    id: '6',
    name: '午夜凶铃',
    theme: '恐怖',
    storeName: '惊魂夜密室',
    playerCount: 4,
    timeLimit: 90,
    actualTime: null,
    escaped: false,
    teammates: [
      { id: 't6-1', name: '胆小鬼', role: '搞笑', comment: '全程尖叫' },
      { id: 't6-2', name: '勇哥', role: '指挥', comment: '临危不乱' },
    ],
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: '7',
    name: '2077：霓虹都市',
    theme: '科幻',
    storeName: '未来纪元',
    playerCount: 4,
    timeLimit: 90,
    actualTime: 82,
    escaped: true,
    teammates: [
      { id: 't7-1', name: '技术宅', role: '脑力', comment: '代码大神' },
      { id: 't7-2', name: '黑客', role: '侦察', comment: '找bug小能手' },
    ],
    createdAt: Date.now() - 86400000 * 14,
  },
  {
    id: '8',
    name: '神探狄仁杰',
    theme: '悬疑',
    storeName: '大唐谜案',
    playerCount: 5,
    timeLimit: 100,
    actualTime: 92,
    escaped: true,
    teammates: [
      { id: 't8-1', name: '元芳', role: '侦察', comment: '你怎么看' },
      { id: 't8-2', name: '狄公', role: '指挥', comment: '神机妙算' },
      { id: 't8-3', name: '虎敬晖', role: '体力', comment: '武艺高强' },
    ],
    createdAt: Date.now() - 86400000 * 20,
  },
];

export function getFilteredRecords(records: EscapeRecord[], filter: FilterState): EscapeRecord[] {
  return records.filter((record) => {
    if (filter.themes.length > 0 && !filter.themes.includes(record.theme)) {
      return false;
    }
    if (filter.escapeStatus === 'success' && !record.escaped) {
      return false;
    }
    if (filter.escapeStatus === 'failed' && record.escaped) {
      return false;
    }
    if (filter.searchText) {
      const lower = filter.searchText.toLowerCase();
      if (
        !record.name.toLowerCase().includes(lower) &&
        !record.storeName.toLowerCase().includes(lower)
      ) {
        return false;
      }
    }
    return true;
  });
}

export function getStats(records: EscapeRecord[]): Stats {
  const totalRecords = records.length;
  const escapedRecords = records.filter((r) => r.escaped);
  const successRate = totalRecords > 0 ? (escapedRecords.length / totalRecords) * 100 : 0;

  const totalTime = escapedRecords.reduce((sum, r) => sum + (r.actualTime || 0), 0);
  const averageEscapeTime = escapedRecords.length > 0 ? totalTime / escapedRecords.length : 0;

  const themeCounts: Record<ThemeType, number> = {
    恐怖: 0,
    悬疑: 0,
    科幻: 0,
    古风: 0,
    搞笑: 0,
  };

  records.forEach((r) => {
    themeCounts[r.theme]++;
  });

  let mostPlayedTheme: ThemeType | null = null;
  let maxCount = 0;
  (Object.keys(themeCounts) as ThemeType[]).forEach((theme) => {
    if (themeCounts[theme] > maxCount) {
      maxCount = themeCounts[theme];
      mostPlayedTheme = theme;
    }
  });

  return {
    totalRecords,
    averageEscapeTime,
    successRate,
    mostPlayedTheme,
    themeCounts,
  };
}

export { initialRecords };
