import { TagEngine } from '../src/chain/index.js';

// ---------- 共享规则 ----------

export const R_NUM = {
  id: 'R-NUM',
  priority: 1,
  scope: { pattern: /[0-9]/ },
  apply: (pos) => (/[0-9]/.test(pos.char) ? 'NUM' : null),
};

export const R_WORD = {
  id: 'R-WORD',
  priority: 1,
  scope: null,
  apply: (pos) => (/[a-z]/i.test(pos.char) ? 'WORD' : null),
};

// 传播规则：前一位置是 WORD 时，'s' 记为 PLURAL（沿依赖方向传播）
export const R_PLURAL = {
  id: 'R-PLURAL',
  priority: 2,
  scope: null,
  requires: ['R-WORD'],
  apply: (pos, api) =>
    pos.char === 's' && pos.index > 0 && api.readOffset(-1) === 'WORD' ? 'PLURAL' : null,
};

// 与 R-WORD 同优先级，在 'x' 上产出不同标记 -> 冲突
export const R_VAR = {
  id: 'R-VAR',
  priority: 1,
  scope: null,
  apply: (pos) => (pos.char === 'x' ? 'VAR' : null),
};

// 下游规则：前一位置被裁为 VAR 时，本位置记为 BOUND（检验裁决后下游不漏推）
export const R_AFTER_VAR = {
  id: 'R-AFTER-VAR',
  priority: 2,
  scope: null,
  requires: ['R-VAR'],
  apply: (pos, api) => (pos.index > 0 && api.readOffset(-1) === 'VAR' ? 'BOUND' : null),
};

// 下游规则：前一位置是 NUM 时记为 FOLLOW（检验规则改写后的下游传播）
export const R_AFTER_NUM = {
  id: 'R-AFTER-NUM',
  priority: 2,
  scope: null,
  requires: ['R-NUM'],
  apply: (pos, api) => (pos.index > 0 && api.readOffset(-1) === 'NUM' ? 'FOLLOW' : null),
};

// 作用范围部分重叠：仅作用于 cam1 来源，与 R-WORD 在 'i' 上重叠
export const R_KEY = {
  id: 'R-KEY',
  priority: 5,
  scope: { sources: ['cam1'] },
  apply: (pos) => (pos.char === 'i' ? 'KEY' : null),
};

// 悬空依赖：读取一个不存在的位置
export const R_GHOST = {
  id: 'R-GHOST',
  priority: 3,
  scope: null,
  apply: (pos, api) => {
    if (pos.char !== 'g') return null;
    api.read('void#99@0');
    return 'HAUNTED';
  },
};

// 依赖成环：c 复制 d 的标记，d 取 c 的反标记 —— 无不动点
export const R_CYCLE_C = {
  id: 'R-CYCLE-C',
  priority: 1,
  scope: null,
  requires: ['R-CYCLE-D'],
  apply: (pos, api) => {
    if (pos.char !== 'c') return null;
    const other = api.readOffset(1);
    return other === null ? 'A' : other;
  },
};

export const R_CYCLE_D = {
  id: 'R-CYCLE-D',
  priority: 1,
  scope: null,
  requires: ['R-CYCLE-C'],
  apply: (pos, api) => {
    if (pos.char !== 'd') return null;
    return api.readOffset(-1) === 'A' ? 'B' : 'A';
  },
};

// ---------- 场景 ----------

export function scenarioFragments() {
  const eng = new TagEngine();
  eng.upsertRule(R_NUM);
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_PLURAL);
  return {
    name: '片段乱序到达 / 重复提交 / 中途修正',
    eng,
    steps: [
      ['乱序到达 seq=2 "s"', () => eng.submitFragment({ source: 'cam1', seq: 2, revision: 0, text: 's' })],
      ['乱序到达 seq=0 "ab"', () => eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'ab' })],
      ['乱序到达 seq=1 "3"', () => eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '3' })],
      ['重复提交 seq=1 rev=0 "3"（幂等忽略）', () => eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '3' })],
      ['同版本冲突提交 seq=1 rev=0 "9"（拒绝）', () => eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '9' })],
      ['中途修正 seq=1 rev=1 "3"->"c"（下游 s 重推为 PLURAL）', () => eng.submitFragment({ source: 'cam1', seq: 1, revision: 1, text: 'c' })],
      ['过期版本 seq=1 rev=0 旧快照重交（stale 拒绝）', () => eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '3' })],
    ],
  };
}

export function scenarioConflict() {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_VAR);
  eng.upsertRule(R_AFTER_VAR);
  return {
    name: '同优先级冲突 -> 保留依据 -> 人工裁决 -> 下游传播',
    eng,
    steps: [
      ['提交片段 "xy"', () => eng.submitFragment({ source: 'cam2', seq: 0, revision: 0, text: 'xy' })],
      ['人工裁决 x := VAR', () => eng.adjudicate('cam2#0@0', 'VAR', '人工判定为变量')],
      ['撤销裁决（恢复冲突中间态）', () => eng.clearAdjudication('cam2#0@0')],
      ['重新裁决 x := VAR', () => eng.adjudicate('cam2#0@0', 'VAR', '复审维持')],
      ['对不存在位置裁决（拒绝并记录）', () => eng.adjudicate('cam2#0@99', 'VAR', '无效目标')],
    ],
  };
}

export function scenarioRuleRewrite() {
  const eng = new TagEngine();
  eng.upsertRule(R_NUM);
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_AFTER_NUM);
  return {
    name: '规则改写 -> 仅重推受影响位置 -> 下游联动',
    eng,
    steps: [
      ['提交片段 "一2uxyz"', () => eng.submitFragment({ source: 'cam3', seq: 0, revision: 0, text: '一2uxyz' })],
      ['改写 R-NUM：作用范围与命中加入中文数字 "一"', () =>
        eng.upsertRule({
          id: 'R-NUM',
          priority: 1,
          scope: { pattern: /[0-9一]/ },
          apply: (pos) => (/[0-9一]/.test(pos.char) ? 'NUM' : null),
        }),
      ],
    ],
  };
}

export function scenarioCycle() {
  const eng = new TagEngine();
  eng.upsertRule(R_CYCLE_C);
  eng.upsertRule(R_CYCLE_D);
  return {
    name: '规则依赖成环 -> 未收敛位置如实列出',
    eng,
    steps: [
      ['提交片段 "cd"', () => eng.submitFragment({ source: 'cam4', seq: 0, revision: 0, text: 'cd' })],
    ],
  };
}

export function scenarioDangling() {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_GHOST);
  return {
    name: '依赖指向不存在的位置 -> 悬空读取可观察',
    eng,
    steps: [
      ['提交片段 "go"', () => eng.submitFragment({ source: 'cam5', seq: 0, revision: 0, text: 'go' })],
    ],
  };
}

export function scenarioOverlap() {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_KEY);
  eng.upsertRule(R_NUM);
  return {
    name: '作用范围部分重叠 -> 重叠位置保留全部命中依据',
    eng,
    steps: [
      ['提交片段 cam1 "i7"', () => eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'i7' })],
      ['提交片段 cam9 "i"（R-KEY 作用域外）', () => eng.submitFragment({ source: 'cam9', seq: 0, revision: 0, text: 'i' })],
    ],
  };
}

export const scenarios = [
  scenarioFragments,
  scenarioConflict,
  scenarioRuleRewrite,
  scenarioCycle,
  scenarioDangling,
  scenarioOverlap,
];
