import type {
  FixationAttempt,
  FixationMaterialSpec,
  FixationState,
  FixationStatus
} from './types';
import { FixationRejection } from './types';

export type {
  FixationAttempt,
  FixationMaterialSpec,
  FixationStatus
} from './types';
export { FixationRejection } from './types';

export const createFixationState = (
  materials: FixationMaterialSpec[]
): FixationState => ({
  specs: materials.map(spec => ({ ...spec })),
  placedOrder: [],
  positions: {},
  attempts: []
});

export const isFixationComplete = (state: FixationState): boolean =>
  state.placedOrder.length === state.specs.length;

export const expectedNextMaterial = (
  state: FixationState
): FixationMaterialSpec | null => {
  const placed = new Set(state.placedOrder);
  const remaining = state.specs
    .filter(spec => !placed.has(spec.id))
    .sort((a, b) => a.order - b.order);
  return remaining[0] ?? null;
};

export const getFixationStatuses = (state: FixationState): FixationStatus[] =>
  state.specs
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(spec => ({
      materialId: spec.id,
      order: spec.order,
      placed: state.placedOrder.includes(spec.id),
      position: state.positions[spec.id] ?? ''
    }));

const rejected = (
  materialId: string,
  position: string,
  rejection: FixationRejection,
  reason: string,
  expectedNextMaterialId: string | null = null
): FixationAttempt => ({
  materialId,
  position,
  accepted: false,
  rejection,
  reason,
  expectedNextMaterialId
});

const withAttempt = (
  state: FixationState,
  attempt: FixationAttempt
): FixationState => ({
  specs: state.specs,
  placedOrder: state.placedOrder,
  positions: state.positions,
  attempts: [...state.attempts, attempt]
});

export const attemptPlacement = (
  state: FixationState,
  materialId: string,
  position: string,
  reductionPassed: boolean
): { state: FixationState; attempt: FixationAttempt } => {
  if (!reductionPassed) {
    const attempt = rejected(
      materialId,
      position,
      FixationRejection.REDUCTION_NOT_PASSED,
      '复位尚未达标，固定阶段不可进入'
    );
    return { state: withAttempt(state, attempt), attempt };
  }

  const material = state.specs.find(spec => spec.id === materialId);
  if (!material) {
    const attempt = rejected(
      materialId,
      position,
      FixationRejection.UNKNOWN_MATERIAL,
      `未知固定材料：${materialId}`
    );
    return { state: withAttempt(state, attempt), attempt };
  }

  if (state.placedOrder.includes(materialId)) {
    const attempt = rejected(
      materialId,
      position,
      FixationRejection.ALREADY_PLACED,
      `材料「${material.name}」已放置，不可重复放置`
    );
    return { state: withAttempt(state, attempt), attempt };
  }

  const expected = expectedNextMaterial(state);
  if (!expected || material.order !== expected.order) {
    const attempt = rejected(
      materialId,
      position,
      FixationRejection.ORDER_VIOLATION,
      `固定顺序错误：期望下一步放置「${expected?.name ?? '无'}」，` +
        `不允许跳跃放置「${material.name}」`,
      expected?.id ?? null
    );
    return { state: withAttempt(state, attempt), attempt };
  }

  if (position !== material.correctPosition) {
    const attempt = rejected(
      materialId,
      position,
      FixationRejection.WRONG_POSITION,
      `材料「${material.name}」位置错误：期望位置为 ${material.correctPosition}，实际为 ${position}`
    );
    return { state: withAttempt(state, attempt), attempt };
  }

  const acceptedAttempt: FixationAttempt = {
    materialId,
    position,
    accepted: true,
    rejection: null,
    reason: `材料「${material.name}」已按第 ${material.order} 步放置到 ${position}`,
    expectedNextMaterialId: null
  };

  return {
    state: {
      specs: state.specs,
      placedOrder: [...state.placedOrder, materialId],
      positions: { ...state.positions, [materialId]: position },
      attempts: [...state.attempts, acceptedAttempt]
    },
    attempt: acceptedAttempt
  };
};
