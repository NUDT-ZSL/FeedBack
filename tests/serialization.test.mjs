// 状态序列化回归测试：
// 包含中文、emoji、特殊字符的卡片文案经过深拷贝与还原后逐字一致，
// 不被转义、不被截断，且深拷贝与源对象完全隔离。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../src/state/HistoryManager.ts';

const TRICKY_TITLE =
  '渐变卡片设计 🎨✨ <标签> & "双引号" \'单引号\' \\反斜杠\\';
const TRICKY_SUBTITLE =
  '换行\n制表\t回车\r 家庭👨‍👩‍👧‍👦 旗帜🇨🇳 组合字符é 零宽​字符 表情🫠 百分号100%';

function makeCardState() {
  return {
    templateId: 'square-card',
    title: {
      content: TRICKY_TITLE,
      fontSize: 36,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: TRICKY_SUBTITLE,
      fontSize: 14,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
  };
}

function assertTextIdentical(restored, original, label) {
  assert.equal(
    restored,
    original,
    `${label}: 还原后文案必须与原文逐字一致`
  );
  assert.equal(
    restored.length,
    original.length,
    `${label}: 长度不得变化（不得截断）`
  );
  assert.deepEqual(
    [...restored],
    [...original],
    `${label}: 逐码点比对必须一致（含 emoji 代理对/组合序列）`
  );
  assert.ok(
    !restored.includes('&amp;') &&
      !restored.includes('&lt;') &&
      !restored.includes('&gt;') &&
      !restored.includes('\\u'),
    `${label}: 深拷贝不得引入转义序列`
  );
}

test('JSON 序列化往返：中文/emoji/特殊字符逐字一致', () => {
  const state = makeCardState();
  const restored = JSON.parse(JSON.stringify(state));
  assertTextIdentical(restored.title.content, TRICKY_TITLE, '标题 JSON 往返');
  assertTextIdentical(
    restored.subtitle.content,
    TRICKY_SUBTITLE,
    '副标题 JSON 往返'
  );
  assert.deepEqual(restored, state);
});

test('历史管理器深拷贝还原：内容逐字一致且不被转义', () => {
  const history = new HistoryManager(20);
  const state = makeCardState();
  history.push(state);
  history.push({ ...state, note: '第二步' });

  const restored = history.undo();
  assertTextIdentical(restored.title.content, TRICKY_TITLE, '撤销还原标题');
  assertTextIdentical(
    restored.subtitle.content,
    TRICKY_SUBTITLE,
    '撤销还原副标题'
  );

  const snapshot = history.getHistory()[0];
  assertTextIdentical(snapshot.title.content, TRICKY_TITLE, '历史快照标题');
  assert.deepEqual(snapshot, state);
});

test('深拷贝隔离性：修改源对象不影响已提交的历史状态', () => {
  const history = new HistoryManager(20);
  const state = makeCardState();
  history.push(state);

  // 提交后原地修改源对象
  state.title.content = '已被篡改';
  state.subtitle.content = '';

  const restored = history.getCurrent();
  assertTextIdentical(restored.title.content, TRICKY_TITLE, '隔离性标题');
  assertTextIdentical(
    restored.subtitle.content,
    TRICKY_SUBTITLE,
    '隔离性副标题'
  );

  // 反向隔离：修改还原结果不得污染历史记录
  restored.title.content = '外部修改';
  assertTextIdentical(
    history.getCurrent().title.content,
    TRICKY_TITLE,
    '反向隔离标题'
  );
});
