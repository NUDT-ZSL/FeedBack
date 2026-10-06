import type { MatchRecord, PersistedStateV1, Score, StoredGalleryItem, TeaPattern } from '../types';
import { emptyPersistedState, makeId, markConflicts } from './persistence';

export const SAMPLE_PATTERNS: TeaPattern[] = [
  {
    id: 'pine_crane',
    type: 'pine_crane',
    name: '松鹤延年',
    poem: '亭亭山上松，瑟瑟谷中风。\n风声一何盛，松枝一何劲。',
    paths: [
      { points: [[20, 80], [25, 60], [28, 40], [30, 30]], strokeWidth: 3 },
      { points: [[30, 35], [40, 38], [48, 42], [52, 38]], strokeWidth: 2 },
      { points: [[55, 60], [60, 45], [68, 38], [75, 35]], strokeWidth: 3 },
    ],
  },
  {
    id: 'butterflies',
    type: 'butterflies',
    name: '双蝶戏花',
    poem: '庄生晓梦迷蝴蝶，望帝春心托杜鹃。\n沧海月明珠有泪，蓝田日暖玉生烟。',
    paths: [
      { points: [[30, 50], [35, 40], [45, 38], [50, 45], [48, 55], [40, 60], [32, 58], [30, 50]], strokeWidth: 2 },
      { points: [[55, 55], [60, 50], [65, 52], [68, 58], [65, 62], [60, 60], [55, 55]], strokeWidth: 2 },
    ],
  },
  {
    id: 'landscape',
    type: 'landscape',
    name: '山水清远',
    poem: '空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。',
    paths: [
      { points: [[10, 70], [20, 50], [30, 60], [40, 45], [50, 55], [60, 40], [70, 50], [80, 35], [90, 45], [95, 55]], strokeWidth: 2 },
      { points: [[10, 75], [25, 72], [40, 74], [55, 70], [70, 73], [85, 68], [95, 72]], strokeWidth: 1.5 },
    ],
  },
  {
    id: 'orchid_bamboo',
    type: 'orchid_bamboo',
    name: '兰竹清韵',
    poem: '咬定青山不放松，立根原在破岩中。\n千磨万击还坚劲，任尔东西南北风。',
    paths: [
      { points: [[25, 80], [28, 60], [30, 45], [32, 35], [35, 25]], strokeWidth: 3 },
      { points: [[55, 75], [58, 65], [62, 58], [65, 50], [68, 45]], strokeWidth: 3 },
    ],
  },
];

export function makeScore(color: number, duration: number, adhesion: number): Score {
  return { color, duration, adhesion, total: Math.round((color + duration + adhesion) / 3) };
}

export function svgThumb(label: string, start: string, end: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<defs><radialGradient id="g" cx="50%" cy="40%" r="70%">` +
    `<stop offset="0%" stop-color="${start}"/><stop offset="100%" stop-color="${end}"/>` +
    `</radialGradient></defs>` +
    `<rect width="160" height="160" fill="url(#g)"/>` +
    `<circle cx="80" cy="80" r="52" fill="none" stroke="#faf5e8" stroke-width="3" opacity="0.8"/>` +
    `<text x="80" y="92" text-anchor="middle" font-size="30" fill="#faf5e8" ` +
    `font-family="serif">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function galleryEntry(
  round: number,
  pattern: TeaPattern,
  score: Score,
  label: string,
  start: string,
  end: string,
  updatedAt: number,
): StoredGalleryItem {
  return {
    id: makeId(),
    pattern,
    thumbnail: svgThumb(label, start, end),
    createdAt: updatedAt - 1000,
    roundScore: score,
    round,
    patternKey: pattern.id,
    updatedAt,
    conflictKey: null,
  };
}

/**
 * Sample offline cache. It deliberately contains two conflicting round-3
 * entries (same round key, different payloads) to exercise restore +
 * adjudication without any network access.
 */
export function createSampleState(now = 1_700_000_000_000): PersistedStateV1 {
  const [pine, butterflies, landscape, orchid] = SAMPLE_PATTERNS;

  const gallery = [
    galleryEntry(1, pine, makeScore(82, 76, 88), '松', '#c49a3c', '#5c3a1e', now - 4000),
    galleryEntry(2, butterflies, makeScore(90, 85, 80), '蝶', '#b88a40', '#4a2e16', now - 3000),
    galleryEntry(3, landscape, makeScore(70, 66, 72), '山', '#a88a3c', '#3a2515', now - 2000),
    galleryEntry(3, landscape, makeScore(95, 92, 90), '山', '#d4a76a', '#5c3a1e', now - 1000),
    galleryEntry(4, orchid, makeScore(60, 58, 62), '兰', '#9a7a3c', '#2a1a0e', now - 500),
  ];

  function record(round: number, user: Score, ai: Score, recordedAt: number): MatchRecord {
    const winner = user.total > ai.total ? 'user' : user.total < ai.total ? 'ai' : 'draw';
    return {
      id: makeId(),
      round,
      userScore: user,
      aiScore: ai,
      winner,
      recordedAt,
      conflictKey: null,
    };
  }

  const records = [
    record(1, makeScore(82, 76, 88), makeScore(70, 68, 72), now - 4000),
    record(2, makeScore(90, 85, 80), makeScore(88, 80, 84), now - 3000),
    record(3, makeScore(70, 66, 72), makeScore(75, 70, 68), now - 2000),
    record(3, makeScore(95, 92, 90), makeScore(75, 70, 68), now - 1000),
    record(4, makeScore(60, 58, 62), makeScore(80, 78, 76), now - 500),
  ];

  return markConflicts({ ...emptyPersistedState(), gallery, records });
}
