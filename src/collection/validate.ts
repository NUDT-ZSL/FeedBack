import type { Scroll, Seal } from '../types/index.ts';
import {
  COLOPHON_MAX_LENGTH,
  DEFAULT_SEAL_POSITION,
  SEAL_COLORS,
  SEAL_POSITION_MAX,
  SEAL_POSITION_MIN,
  SEAL_ROTATION_MAX,
  SEAL_ROTATION_MIN,
  SEAL_SHAPE_CHARACTERS,
  SEAL_SHAPES,
} from './constants.ts';
import type { AdjudicationRecord, DerivedCollectionItem, RawCollectionRecord, RawSeal } from './types.ts';

const adjudicationId = (scrollId: string, kind: string, field: string): string =>
  `${scrollId}::${kind}::${field}`;

const makeAdjudication = (
  scrollId: string,
  kind: AdjudicationRecord['kind'],
  field: string,
  input: unknown,
  decision: string,
  output: unknown,
  reason: string,
  at: number,
): AdjudicationRecord => ({
  id: adjudicationId(scrollId, kind, field),
  scrollId,
  kind,
  field,
  input,
  decision,
  output,
  reason,
  at,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * 裁决一枚原始印章。
 * 形状/颜色越界或缺失 → 整枚印章作废（返回 null），并分别留痕；
 * 字与形状不匹配 → 采用形状对应的固定字；
 * 旋转/位置越界或缺失 → 收敛到既有可选范围，保留裁决依据。
 */
export const adjudicateSeal = (
  raw: RawSeal | null | undefined,
  scrollId: string,
  at: number,
): { seal: Seal | null; adjudications: AdjudicationRecord[] } => {
  const adjudications: AdjudicationRecord[] = [];

  if (raw === null || raw === undefined) {
    return { seal: null, adjudications };
  }

  let valid = true;
  const shape = (SEAL_SHAPES as readonly unknown[]).includes(raw.shape)
    ? (raw.shape as Seal['shape'])
    : null;

  if (shape === null) {
    valid = false;
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-shape-invalid',
        'seal.shape',
        raw.shape ?? null,
        `形状不在可选范围 ${SEAL_SHAPES.join(' | ')} 内，整枚印章作废`,
        null,
        '形状是印章的一级裁决字段，无法映射到任何既有印章样式',
        at,
      ),
    );
  }

  const color = (SEAL_COLORS as readonly unknown[]).includes(raw.color)
    ? (raw.color as Seal['color'])
    : null;

  if (color === null) {
    valid = false;
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-color-invalid',
        'seal.color',
        raw.color ?? null,
        `颜色不在可选范围 ${SEAL_COLORS.join(' | ')} 内，整枚印章作废`,
        null,
        '颜色是印章的一级裁决字段，无法映射到任何既有印色',
        at,
      ),
    );
  }

  if (!valid || shape === null || color === null) {
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-rejected',
        'seal',
        raw,
        '一级字段（形状或颜色）无法裁决，印章整体拒绝并入藏结果',
        null,
        '禁止用默认形状/默认颜色静默替换用户提交的越界取值',
        at,
      ),
    );
    return { seal: null, adjudications };
  }

  const character = SEAL_SHAPE_CHARACTERS[shape];
  if (raw.character !== undefined && raw.character !== character) {
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-character-invalid',
        'seal.character',
        raw.character ?? null,
        `印文必须与形状绑定，采用「${shape}」对应的「${character}」`,
        character,
        '同一形状只允许唯一印文，用户提交值不得改变最终收藏结果',
        at,
      ),
    );
  }

  const rotationInput = raw.rotation;
  let rotation: number;
  if (!isFiniteNumber(rotationInput)) {
    rotation = SEAL_ROTATION_MIN;
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-rotation-clamped',
        'seal.rotation',
        rotationInput ?? null,
        `旋转缺失或非有限数，回退到 ${SEAL_ROTATION_MIN}°`,
        rotation,
        `合法区间为 [${SEAL_ROTATION_MIN}, ${SEAL_ROTATION_MAX}] 度`,
        at,
      ),
    );
  } else if (rotationInput < SEAL_ROTATION_MIN || rotationInput > SEAL_ROTATION_MAX) {
    rotation = clamp(rotationInput, SEAL_ROTATION_MIN, SEAL_ROTATION_MAX);
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-rotation-clamped',
        'seal.rotation',
        rotationInput,
        `旋转越界，收敛到区间边界 ${rotation}°`,
        rotation,
        `合法区间为 [${SEAL_ROTATION_MIN}, ${SEAL_ROTATION_MAX}] 度`,
        at,
      ),
    );
  } else {
    rotation = rotationInput;
  }

  const rawPosition = (raw.position ?? {}) as { x?: unknown; y?: unknown };
  const positionClamps: Array<{ axis: 'x' | 'y'; input: unknown; output: number; missing: boolean }> = [];
  (['x', 'y'] as const).forEach((axis) => {
    const input = rawPosition[axis];
    if (!isFiniteNumber(input)) {
      positionClamps.push({ axis, input: input ?? null, output: DEFAULT_SEAL_POSITION[axis], missing: true });
    } else if (input < SEAL_POSITION_MIN || input > SEAL_POSITION_MAX) {
      positionClamps.push({
        axis,
        input,
        output: clamp(input, SEAL_POSITION_MIN, SEAL_POSITION_MAX),
        missing: false,
      });
    } else {
      positionClamps.push({ axis, input, output: input, missing: false });
    }
  });

  positionClamps.forEach(({ axis, input, output, missing }) => {
    if (input === output && !missing) return;
    adjudications.push(
      makeAdjudication(
        scrollId,
        'seal-position-clamped',
        `seal.position.${axis}`,
        input,
        missing
          ? `位置缺失或非有限数，回退到默认值 ${output}`
          : `位置越界，收敛到区间边界 ${output}`,
        output,
        `合法区间为 [${SEAL_POSITION_MIN}, ${SEAL_POSITION_MAX}]（百分比）`,
        at,
      ),
    );
  });
  const x = positionClamps[0].output;
  const y = positionClamps[1].output;

  const seal: Seal = {
    id: `seal-${scrollId}`,
    shape,
    character,
    color,
    rotation,
    position: { x, y },
  };
  return { seal, adjudications };
};

/** 裁决题跋：非文本置空，超过上限截断；空字符串本身是合法收藏结果。 */
export const adjudicateColophon = (
  raw: unknown,
  scrollId: string,
  at: number,
): { colophon: string; adjudications: AdjudicationRecord[] } => {
  if (typeof raw !== 'string') {
    return {
      colophon: '',
      adjudications:
        raw === undefined
          ? []
          : [
              makeAdjudication(
                scrollId,
                'colophon-truncated',
                'colophon',
                raw,
                '题跋不是文本，置为空字符串',
                '',
                '收藏结果只接受字符串题跋',
                at,
              ),
            ],
    };
  }
  if (raw.length <= COLOPHON_MAX_LENGTH) {
    return { colophon: raw, adjudications: [] };
  }
  const truncated = raw.slice(0, COLOPHON_MAX_LENGTH);
  return {
    colophon: truncated,
    adjudications: [
      makeAdjudication(
        scrollId,
        'colophon-truncated',
        'colophon',
        raw,
        `题跋超过 ${COLOPHON_MAX_LENGTH} 字上限，截断保留前 ${COLOPHON_MAX_LENGTH} 字`,
        truncated,
        `题跋最大长度为 ${COLOPHON_MAX_LENGTH} 字`,
        at,
      ),
    ],
  };
};

/** 裁决单条收藏（不含顺序），scroll 无法解析时返回 null。 */
export const adjudicateRecord = (
  record: RawCollectionRecord,
  scroll: Scroll | undefined,
): { item: Omit<DerivedCollectionItem, 'order'> | null; adjudications: AdjudicationRecord[] } => {
  const at = record.collectedAt;
  if (!scroll) {
    return {
      item: null,
      adjudications: [
        makeAdjudication(
          record.scrollId,
          'scroll-not-found',
          'scrollId',
          record.scrollId,
          '卷轴目录中找不到该 id，收藏记录剔除',
          null,
          '推导链以卷轴为根，根缺失则印章、题跋均无法推导',
          at,
        ),
      ],
    };
  }

  const { seal, adjudications: sealAdj } = adjudicateSeal(record.seal ?? null, record.scrollId, at);
  const { colophon, adjudications: colophonAdj } = adjudicateColophon(
    record.colophon,
    record.scrollId,
    at,
  );

  return {
    item: { scrollId: record.scrollId, scroll, colophon, seal, collectedAt: at },
    adjudications: [...sealAdj, ...colophonAdj],
  };
};
