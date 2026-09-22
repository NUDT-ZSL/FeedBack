// ================= 示例数据（内置，离线可用） =================
// 知识点图谱：prereqs 为前置依赖。
// 故意包含：依赖环 KP11<->KP12、缺失依赖 KP13->KP99，用于演示"不可信"标记。
const KNOWLEDGE = [
  { id: 'KP01', name: '变量与类型', hours: 3, prereqs: [] },
  { id: 'KP02', name: '条件分支',   hours: 3, prereqs: ['KP01'] },
  { id: 'KP03', name: '循环结构',   hours: 4, prereqs: ['KP01'] },
  { id: 'KP04', name: '函数',       hours: 5, prereqs: ['KP02', 'KP03'] },
  { id: 'KP05', name: '数组',       hours: 4, prereqs: ['KP03'] },
  { id: 'KP06', name: '字符串处理', hours: 3, prereqs: ['KP01'] },
  { id: 'KP07', name: '递归',       hours: 5, prereqs: ['KP04'] },
  { id: 'KP08', name: '排序算法',   hours: 6, prereqs: ['KP05', 'KP07'] },
  { id: 'KP09', name: '查找算法',   hours: 4, prereqs: ['KP05'] },
  { id: 'KP10', name: '复杂度分析', hours: 5, prereqs: ['KP08', 'KP09'] },
  { id: 'KP11', name: '图遍历',     hours: 5, prereqs: ['KP12'] },
  { id: 'KP12', name: '最短路径',   hours: 6, prereqs: ['KP11'] },
  { id: 'KP13', name: '动态规划',   hours: 8, prereqs: ['KP07', 'KP99'] },
];

const LEARNERS = [
  { id: 'L1', name: '陈曦' },
  { id: 'L2', name: '李牧' },
  { id: 'L3', name: '王珂' },
];

// 作答记录。verdict: mastered=掌握, failed=未掌握。
// 故意包含：完全重复记录、时刻倒序、互相矛盾的掌握判定。
const RECORDS = [
  // 陈曦：KP01 有重复记录；KP02 时刻倒序（更早的 failed 出现在文件后面）；
  //       KP03 两条记录判定互相矛盾。
  { learner: 'L1', kp: 'KP01', ts: '2026-08-01T09:00', verdict: 'mastered', source: '测验#A01' },
  { learner: 'L1', kp: 'KP01', ts: '2026-08-01T09:00', verdict: 'mastered', source: '测验#A01' },
  { learner: 'L1', kp: 'KP02', ts: '2026-08-05T10:00', verdict: 'mastered', source: '测验#A07' },
  { learner: 'L1', kp: 'KP02', ts: '2026-08-03T10:00', verdict: 'failed',   source: '作业#A03' },
  { learner: 'L1', kp: 'KP03', ts: '2026-08-06T11:00', verdict: 'mastered', source: '测验#A09' },
  { learner: 'L1', kp: 'KP03', ts: '2026-08-07T11:00', verdict: 'failed',   source: '测验#A10' },
  { learner: 'L1', kp: 'KP06', ts: '2026-08-04T08:30', verdict: 'mastered', source: '作业#A04' },
  // 李牧：直接掌握 KP04（可沿依赖向前推断 KP02/KP03 已掌握）；KP05 判定矛盾。
  { learner: 'L2', kp: 'KP01', ts: '2026-08-02T09:00', verdict: 'mastered', source: '测验#B01' },
  { learner: 'L2', kp: 'KP04', ts: '2026-08-09T14:00', verdict: 'mastered', source: '项目#B06' },
  { learner: 'L2', kp: 'KP05', ts: '2026-08-08T10:00', verdict: 'mastered', source: '测验#B07' },
  { learner: 'L2', kp: 'KP05', ts: '2026-08-10T10:00', verdict: 'failed',   source: '作业#B04' },
  { learner: 'L2', kp: 'KP09', ts: '2026-08-11T09:00', verdict: 'failed',   source: '测验#B08' },
  // 王珂：记录较少且有重复，大量知识点未解锁。
  { learner: 'L3', kp: 'KP01', ts: '2026-08-03T09:00', verdict: 'mastered', source: '测验#C01' },
  { learner: 'L3', kp: 'KP02', ts: '2026-08-04T09:00', verdict: 'failed',   source: '测验#C02' },
  { learner: 'L3', kp: 'KP02', ts: '2026-08-04T09:00', verdict: 'failed',   source: '测验#C02' },
];
