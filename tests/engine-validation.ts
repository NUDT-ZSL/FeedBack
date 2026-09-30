declare const require: any;

const test = require('node:test');
const assert = require('node:assert/strict');

import {
  ECHO_TIME_WINDOW_MS,
  Message,
  reactorEngine
} from '../src/modules/reactor/ReactorEngine';
import { emotionAnalyzer } from '../src/modules/services/EmotionAnalyzer';

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'emotionType' | 'timestamp'>): Message {
  return {
    content: '',
    emoji: '💭',
    intensity: 1,
    anonymousName: '测试旅人',
    echoCount: 0,
    echoIds: [],
    ...overrides
  };
}

test('回响匹配：同窗口同情绪稳定复现，边界和超窗消息不计入，且不受顺序影响', () => {
  const baseTime = 1_000_000;
  const incoming = createMessage({
    id: 'new',
    content: '开心',
    emotionType: 'positive',
    timestamp: baseTime
  });

  const candidates = [
    createMessage({ id: 'at-boundary', emotionType: 'positive', timestamp: baseTime - ECHO_TIME_WINDOW_MS }),
    createMessage({ id: 'outside', emotionType: 'positive', timestamp: baseTime - ECHO_TIME_WINDOW_MS - 1 }),
    createMessage({ id: 'later-in-window', emotionType: 'positive', timestamp: baseTime + 15_000 }),
    createMessage({ id: 'negative-in-window', emotionType: 'negative', timestamp: baseTime + 20_000 }),
    createMessage({ id: 'earlier-in-window', emotionType: 'positive', timestamp: baseTime - 15_000 }),
    createMessage({ id: 'future-at-boundary', emotionType: 'positive', timestamp: baseTime + ECHO_TIME_WINDOW_MS }),
    createMessage({ id: 'future-outside', emotionType: 'positive', timestamp: baseTime + ECHO_TIME_WINDOW_MS + 1 })
  ];

  const first = reactorEngine.analyzeAndMatch(incoming, candidates);
  const second = reactorEngine.analyzeAndMatch(incoming, [...candidates].reverse());

  assert.deepEqual(first.matchedIds, ['earlier-in-window', 'later-in-window']);
  assert.deepEqual(second.matchedIds, first.matchedIds);
  assert.deepEqual(second.newMessage.echoIds, first.newMessage.echoIds);

  for (const result of [first, second]) {
    assert.equal(result.updatedMessages.find(message => message.id === 'earlier-in-window')?.echoCount, 1);
    assert.equal(result.updatedMessages.find(message => message.id === 'later-in-window')?.echoCount, 1);
    assert.equal(result.updatedMessages.find(message => message.id === 'at-boundary')?.echoCount, 0);
    assert.equal(result.updatedMessages.find(message => message.id === 'future-at-boundary')?.echoCount, 0);
    assert.equal(result.updatedMessages.find(message => message.id === 'outside')?.echoCount, 0);
    assert.equal(result.updatedMessages.find(message => message.id === 'negative-in-window')?.echoCount, 0);
  }
});

test('整体情绪指数：空列表中性，正负混合在 0-100，随强度单调，且与顺序和系统时间无关', () => {
  const referenceTime = 2_000_000;
  assert.equal(reactorEngine.calculateOverallEmotionIndex([]), 50);

  const indexesByPositiveIntensity = [1, 2, 3, 4, 5].map(positiveIntensity => [
    createMessage({
      id: 'negative',
      emotionType: 'negative',
      intensity: 1,
      timestamp: referenceTime
    }),
    createMessage({
      id: 'positive',
      emotionType: 'positive',
      intensity: positiveIntensity,
      timestamp: referenceTime
    })
  ]).map(messages => reactorEngine.calculateOverallEmotionIndex(
    messages,
    { referenceTime }
  ));

  assert.ok(indexesByPositiveIntensity.every(index => index >= 0 && index <= 100));
  for (let i = 1; i < indexesByPositiveIntensity.length; i++) {
    assert.ok(
      indexesByPositiveIntensity[i] > indexesByPositiveIntensity[i - 1],
      '正面消息增强时整体情绪指数必须严格上升'
    );
  }

  const indexesByNegativeIntensity = [1, 2, 3, 4, 5].map(negativeIntensity => [
    createMessage({
      id: 'positive-base',
      emotionType: 'positive',
      intensity: 1,
      timestamp: referenceTime
    }),
    createMessage({
      id: 'negative-changing',
      emotionType: 'negative',
      intensity: negativeIntensity,
      timestamp: referenceTime
    })
  ]).map(messages => reactorEngine.calculateOverallEmotionIndex(
    messages,
    { referenceTime }
  ));

  for (let i = 1; i < indexesByNegativeIntensity.length; i++) {
    assert.ok(
      indexesByNegativeIntensity[i] < indexesByNegativeIntensity[i - 1],
      '负面消息增强时整体情绪指数必须严格下降'
    );
  }

  const messages = [
    createMessage({ id: 'positive-1', emotionType: 'positive', intensity: 3, timestamp: referenceTime - 30_000 }),
    createMessage({ id: 'negative-1', emotionType: 'negative', intensity: 2, timestamp: referenceTime - 20_000 }),
    createMessage({ id: 'neutral-1', emotionType: 'neutral', intensity: 1, timestamp: referenceTime - 10_000 }),
    createMessage({ id: 'positive-2', emotionType: 'positive', intensity: 4, timestamp: referenceTime })
  ];
  const orderedIndex = reactorEngine.calculateOverallEmotionIndex(messages, { referenceTime });
  const shuffledIndex = reactorEngine.calculateOverallEmotionIndex(
    [...messages].reverse(),
    { referenceTime }
  );
  assert.equal(shuffledIndex, orderedIndex);

  const originalNow = Date.now;
  Date.now = () => referenceTime + 60 * 60 * 1000;
  try {
    assert.equal(
      reactorEngine.calculateOverallEmotionIndex(messages, { referenceTime }),
      orderedIndex
    );
    assert.equal(
      reactorEngine.calculateOverallEmotionIndex(messages),
      orderedIndex
    );
  } finally {
    Date.now = originalNow;
  }
});

test('情绪统计：空列表和单一情绪明确，所有计数组合四舍五入后合计均为 100', () => {
  assert.deepEqual(
    reactorEngine.calculateEmotionStats([]),
    { positive: 33, negative: 33, neutral: 34 }
  );

  const allPositive = Array.from({ length: 7 }, (_, index) =>
    createMessage({ id: `positive-${index}`, emotionType: 'positive', timestamp: index })
  );
  assert.deepEqual(
    reactorEngine.calculateEmotionStats(allPositive),
    { positive: 100, negative: 0, neutral: 0 }
  );

  for (let total = 1; total <= 30; total++) {
    for (let positive = 0; positive <= total; positive++) {
      for (let negative = 0; negative <= total - positive; negative++) {
        const neutral = total - positive - negative;
        const messages = [
          ...Array.from({ length: positive }, (_, index) =>
            createMessage({ id: `p-${positive}-${negative}-${index}`, emotionType: 'positive', timestamp: index })
          ),
          ...Array.from({ length: negative }, (_, index) =>
            createMessage({ id: `n-${positive}-${negative}-${index}`, emotionType: 'negative', timestamp: index })
          ),
          ...Array.from({ length: neutral }, (_, index) =>
            createMessage({ id: `u-${positive}-${negative}-${index}`, emotionType: 'neutral', timestamp: index })
          )
        ];

        const stats = reactorEngine.calculateEmotionStats(messages);
        assert.ok(Number.isInteger(stats.positive));
        assert.ok(Number.isInteger(stats.negative));
        assert.ok(Number.isInteger(stats.neutral));
        assert.equal(
          stats.positive + stats.negative + stats.neutral,
          100,
          `总数 ${total}、计数 ${positive}/${negative}/${neutral} 的占比合计不是 100`
        );
      }
    }
  }
});

test('情绪判定：重复文本一致，关键词和表情综合计分，空白和纯表情均有确定结果', () => {
  const analyzer = emotionAnalyzer;

  const repeatedText = '今天很开心，也有一点压力 😊';
  assert.deepEqual(analyzer.analyze(repeatedText), analyzer.analyze(repeatedText));

  const blank = analyzer.analyze('   \n\t  ');
  assert.equal(blank.emotionType, 'neutral');
  assert.equal(blank.intensity, 1);

  const keywordOnly = analyzer.analyze('开心');
  const keywordWithEmoji = analyzer.analyze('开心😊');
  assert.equal(keywordOnly.emotionType, 'positive');
  assert.equal(keywordOnly.intensity, 1);
  assert.equal(keywordWithEmoji.emotionType, 'positive');
  assert.equal(keywordWithEmoji.intensity, 2);
  assert.ok(keywordWithEmoji.keywords.includes('开心'));
  assert.ok(keywordWithEmoji.keywords.includes('😊'));

  const positiveEmoji = analyzer.analyze('😊');
  assert.equal(positiveEmoji.emotionType, 'positive');
  assert.equal(positiveEmoji.intensity, 1);

  const negativeEmoji = analyzer.analyze('😭');
  assert.equal(negativeEmoji.emotionType, 'negative');
  assert.equal(negativeEmoji.intensity, 1);

  const unknownEmoji = analyzer.analyze('🌙');
  assert.deepEqual(unknownEmoji, { emotionType: 'neutral', intensity: 1, keywords: [] });
});
