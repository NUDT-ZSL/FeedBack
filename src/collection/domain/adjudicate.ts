import {
  SEAL_SHAPES,
  SEAL_COLORS,
  SEAL_CHARACTER_BY_SHAPE,
  SEAL_ROTATION_MIN,
  SEAL_ROTATION_MAX,
  SEAL_POSITION_MIN,
  SEAL_POSITION_MAX,
  COLOPHON_MAX_LENGTH,
  type Scroll,
  type SealShape,
  type SealColor,
} from '../../types/index.ts';
import type {
  RawCollectionEntry,
  RawSeal,
  AdjudicationIssue,
  SealVerdict,
  IssueCode,
} from './raw.ts';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const issue = (
  code: IssueCode,
  severity: AdjudicationIssue['severity'],
  path: string,
  received: unknown,
  resolution: string,
): AdjudicationIssue => ({ code, severity, path, received, resolution });

/**
 * 数值归一化策略（对所有字段一致）：
 * - 缺失      -> fallback 到默认值，记录 fallback 依据
 * - 非有限数   -> reject（无法裁决），记录 reject 依据
 * - 有限但越界 -> clamp 到边界，记录 clamp 依据（原值/边界/结果可追溯）
 */
const resolveNumber = (
  value: unknown,
  path: string,
  min: number,
  max: number,
  fallback: number,
  issues: AdjudicationIssue[],
  belowCode: IssueCode,
  aboveCode: IssueCode,
  notNumberCode: IssueCode,
  missingCode: IssueCode,
): number | null => {
  if (value === undefined || value === null) {
    issues.push(issue(missingCode, 'fallback', path, value, `缺失，回退为 ${fallback}`));
    return fallback;
  }
  if (!isFiniteNumber(value)) {
    issues.push(issue(notNumberCode, 'reject', path, value, '非有限数值，无法裁决'));
    return null;
  }
  if (value < min) {
    issues.push(issue(belowCode, 'clamp', path, value, `低于下界 ${min}，归一化为 ${min}`));
    return min;
  }
  if (value > max) {
    issues.push(issue(aboveCode, 'clamp', path, value, `高于上界 ${max}，归一化为 ${max}`));
    return max;
  }
  return value;
};

/** 裁决一枚印章：形状/颜色必须落在既有可选范围内，数值字段按统一策略归一化 */
export function adjudicateSeal(rawSeal: RawSeal | null | undefined, pathPrefix: string): SealVerdict {
  if (rawSeal === null || rawSeal === undefined) {
    return { accepted: true, seal: null, issues: [] };
  }
  const issues: AdjudicationIssue[] = [];

  if (typeof rawSeal !== 'object' || Array.isArray(rawSeal)) {
    issues.push(issue('seal.shape-unknown', 'reject', pathPrefix, rawSeal, '印章必须是对象，整条印章裁决拒绝'));
    return { accepted: false, seal: null, issues };
  }

  let rejected = false;

  const shapeKnown = typeof rawSeal.shape === 'string' && (SEAL_SHAPES as readonly string[]).includes(rawSeal.shape);
  if (!shapeKnown) {
    issues.push(
      issue('seal.shape-unknown', 'reject', `${pathPrefix}.shape`, rawSeal.shape,
        `形状必须是 ${SEAL_SHAPES.join('/')} 之一，印章裁决拒绝`),
    );
    rejected = true;
  }
  const colorKnown = typeof rawSeal.color === 'string' && (SEAL_COLORS as readonly string[]).includes(rawSeal.color);
  if (!colorKnown) {
    issues.push(
      issue('seal.color-unknown', 'reject', `${pathPrefix}.color`, rawSeal.color,
        `颜色必须是 ${SEAL_COLORS.join('/')} 之一，印章裁决拒绝`),
    );
    rejected = true;
  }

  const rotation = resolveNumber(
    rawSeal.rotation,
    `${pathPrefix}.rotation`,
    SEAL_ROTATION_MIN,
    SEAL_ROTATION_MAX,
    0,
    issues,
    'seal.rotation-below-range',
    'seal.rotation-above-range',
    'seal.rotation-not-number',
    'seal.rotation-not-number',
  );
  if (rotation === null) rejected = true;

  const position = (typeof rawSeal.position === 'object' && rawSeal.position !== null && !Array.isArray(rawSeal.position)
    ? rawSeal.position as { x?: unknown; y?: unknown }
    : null);

  const resolveAxis = (axis: 'x' | 'y'): number | null => {
    if (position === null) {
      issues.push(issue(
        axis === 'x' ? 'seal.position-x-missing' : 'seal.position-y-missing',
        'fallback',
        `${pathPrefix}.position.${axis}`,
        rawSeal.position,
        'position 缺失，回退为右下角 1',
      ));
      return SEAL_POSITION_MAX;
    }
    const value = position[axis];
    if (value === undefined || value === null) {
      issues.push(issue(
        axis === 'x' ? 'seal.position-x-missing' : 'seal.position-y-missing',
        'fallback',
        `${pathPrefix}.position.${axis}`,
        value,
        '坐标缺失，回退为右下角 1',
      ));
      return SEAL_POSITION_MAX;
    }
    return resolveNumber(
      value,
      `${pathPrefix}.position.${axis}`,
      SEAL_POSITION_MIN,
      SEAL_POSITION_MAX,
      SEAL_POSITION_MAX,
      issues,
      axis === 'x' ? 'seal.position-x-below-range' : 'seal.position-y-below-range',
      axis === 'x' ? 'seal.position-x-above-range' : 'seal.position-y-above-range',
      axis === 'x' ? 'seal.position-x-not-number' : 'seal.position-y-not-number',
      axis === 'x' ? 'seal.position-x-missing' : 'seal.position-y-missing',
    );
  };

  const posX = resolveAxis('x');
  const posY = resolveAxis('y');
  if (posX === null || posY === null) rejected = true;

  // 形状未知的多余字段不具名裁决；仅对已知形状对象上的未知字段留痕
  if (shapeKnown) {
    const known = new Set(['id', 'shape', 'character', 'color', 'rotation', 'position']);
    for (const key of Object.keys(rawSeal)) {
      if (!known.has(key)) {
        issues.push(issue('seal.unknown-field', 'info', `${pathPrefix}.${key}`, (rawSeal as Record<string, unknown>)[key], '未知字段，忽略'));
      }
    }
  }

  let sealId = '';
  if (typeof rawSeal.id === 'string' && rawSeal.id.length > 0) {
    sealId = rawSeal.id;
  } else {
    issues.push(issue('seal.id-not-string', 'fallback', `${pathPrefix}.id`, rawSeal.id, 'id 缺失或非字符串，由卷轴归属生成'));
  }

  if (rejected) {
    return { accepted: false, seal: null, issues };
  }

  const shape = rawSeal.shape as SealShape;
  const expectedCharacter = SEAL_CHARACTER_BY_SHAPE[shape];
  if (rawSeal.character !== undefined && rawSeal.character !== expectedCharacter) {
    issues.push(
      issue('seal.character-mismatch', 'info', `${pathPrefix}.character`, rawSeal.character,
        `篆字由形状唯一确定，应为「${expectedCharacter}」，以形状为准`),
    );
  }

  return {
    accepted: true,
    seal: {
      id: sealId,
      shape,
      character: expectedCharacter,
      color: rawSeal.color as SealColor,
      rotation: rotation as number,
      position: { x: posX as number, y: posY as number },
    },
    issues,
  };
}

/** 归一化 order 字段：非数值/负数/非整数一律排到末尾(null)并留痕；缺失为空位(null) */
export function normalizeOrder(value: unknown, path: string): { order: number | null; issues: AdjudicationIssue[] } {
  const issues: AdjudicationIssue[] = [];
  if (value === undefined || value === null) return { order: null, issues };
  if (!isFiniteNumber(value)) {
    issues.push(issue('entry.order-not-number', 'fallback', path, value, '排序非数值，排到末尾'));
    return { order: null, issues };
  }
  if (value < 0) {
    issues.push(issue('entry.order-negative', 'fallback', path, value, '排序为负，排到末尾'));
    return { order: null, issues };
  }
  if (!Number.isInteger(value)) {
    issues.push(issue('entry.order-not-integer', 'fallback', path, value, '排序非整数，排到末尾'));
    return { order: null, issues };
  }
  return { order: value, issues };
}

/** 裁决单条收藏原始记录，输出归一化结果或拒绝依据 */
export function adjudicateEntry(
  raw: RawCollectionEntry,
  pathBase: string,
  catalogById: Map<string, Scroll>,
  knownScrollIds: Set<string>,
): {
  scrollId: string | null;
  accepted: boolean;
  normalized: {
    scrollId: string;
    colophon: string;
    seal: SealVerdict;
    collectedAt: number;
    order: number | null;
  } | null;
  issues: AdjudicationIssue[];
} {
  const path = pathBase;
  const issues: AdjudicationIssue[] = [];

  const scrollId = typeof raw.scrollId === 'string' ? raw.scrollId : null;
  if (scrollId === null || !catalogById.has(scrollId)) {
    issues.push(issue('entry.unknown-scroll', 'reject', `${path}.scrollId`, raw.scrollId, '卷轴不在本地目录中，整条收藏拒绝'));
    return { scrollId, accepted: false, normalized: null, issues };
  }
  if (knownScrollIds.has(scrollId)) {
    issues.push(issue('entry.duplicate-scroll', 'reject', path, scrollId, '同一卷轴重复出现，保留最先一条'));
    return { scrollId, accepted: false, normalized: null, issues };
  }
  knownScrollIds.add(scrollId);

  let colophon = '';
  if (raw.colophon === undefined || raw.colophon === null) {
    colophon = '';
  } else if (typeof raw.colophon !== 'string') {
    issues.push(issue('entry.colophon-not-string', 'fallback', `${path}.colophon`, raw.colophon, '题跋非字符串，回退为空跋文'));
  } else if (raw.colophon.length > COLOPHON_MAX_LENGTH) {
    issues.push(issue('entry.colophon-too-long', 'clamp', `${path}.colophon`, raw.colophon.length, `题跋超出 ${COLOPHON_MAX_LENGTH} 字，截断`));
    colophon = raw.colophon.slice(0, COLOPHON_MAX_LENGTH);
  } else {
    colophon = raw.colophon;
  }

  const seal = adjudicateSeal(raw.seal, `${path}.seal`);
  issues.push(...seal.issues);

  let collectedAt: number;
  if (raw.collectedAt === undefined || raw.collectedAt === null) {
    issues.push(issue('entry.collected-at-not-number', 'fallback', `${path}.collectedAt`, raw.collectedAt, '入藏时间缺失，回退为 0'));
    collectedAt = 0;
  } else if (!isFiniteNumber(raw.collectedAt)) {
    issues.push(issue('entry.collected-at-not-number', 'fallback', `${path}.collectedAt`, raw.collectedAt, '入藏时间非数值，回退为 0'));
    collectedAt = 0;
  } else if (raw.collectedAt < 0) {
    issues.push(issue('entry.collected-at-negative', 'clamp', `${path}.collectedAt`, raw.collectedAt, '入藏时间为负，归一化为 0'));
    collectedAt = 0;
  } else {
    collectedAt = raw.collectedAt;
  }

  const orderResult = normalizeOrder(raw.order, `${path}.order`);
  // 注意：order 的裁决问题由 deriveAll 每次按原始记录单独并入（order 是全局依赖，
  // 切片缓存不携带它），这里只取归一化值。
  const order = orderResult.order;

  return {
    scrollId,
    accepted: true,
    normalized: { scrollId, colophon, seal, collectedAt, order },
    issues,
  };
}
