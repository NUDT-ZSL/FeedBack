import type {
  FixationMaterialSpec,
  FixationState,
  PlacementResult
} from './types.ts';

/** 创建固定阶段初始状态 */
export function createFixationState(reductionAchieved: boolean): FixationState {
  return { reductionAchieved, placed: [], attempts: [] };
}

function reject(
  materialId: string,
  position: string,
  rejection: PlacementResult['rejection']
): PlacementResult {
  return { accepted: false, materialId, position, rejection };
}

/**
 * 按既定顺序放置固定材料。
 * 纯函数：不修改入参，返回新状态与可追溯的放置结果。
 * 任何拒绝都不改变已放置集合。
 */
export function placeMaterial(
  state: FixationState,
  specs: FixationMaterialSpec[],
  materialId: string,
  position: string
): { state: FixationState; result: PlacementResult } {
  const record = (result: PlacementResult): { state: FixationState; result: PlacementResult } => ({
    state: result.accepted ? state : { ...state, attempts: [...state.attempts, result] },
    result
  });

  if (!state.reductionAchieved) {
    return record(reject(materialId, position, {
      reason: 'REDUCTION_NOT_ACHIEVED',
      message: '复位未达标，固定阶段不可进入'
    }));
  }

  const spec = specs.find(s => s.id === materialId);
  if (!spec) {
    return record(reject(materialId, position, {
      reason: 'UNKNOWN_MATERIAL',
      message: `未知固定材料: ${materialId}`
    }));
  }

  if (state.placed.some(p => p.materialId === materialId)) {
    return record(reject(materialId, position, {
      reason: 'ALREADY_PLACED',
      message: `材料「${spec.name}」已放置，重复放置被拒绝`
    }));
  }

  const nextOrder = state.placed.length + 1;
  if (spec.order !== nextOrder) {
    const expected = specs.find(s => s.order === nextOrder);
    return record(reject(materialId, position, {
      reason: 'OUT_OF_ORDER',
      message: `固定顺序错误：当前应放置第 ${nextOrder} 步「${expected?.name ?? '?'}」，而非第 ${spec.order} 步「${spec.name}」`,
      expectedMaterialId: expected?.id,
      expectedMaterialName: expected?.name
    }));
  }

  if (position !== spec.correctPosition) {
    return record(reject(materialId, position, {
      reason: 'WRONG_POSITION',
      message: `材料「${spec.name}」位置错误：期望「${spec.correctPosition}」，实际「${position}」`
    }));
  }

  const result: PlacementResult = { accepted: true, materialId, position };
  const nextState: FixationState = {
    ...state,
    placed: [...state.placed, { materialId, position, sequence: nextOrder }],
    attempts: [...state.attempts, result]
  };
  return { state: nextState, result };
}

/** 固定是否全部完成 */
export function isFixationComplete(state: FixationState, specs: FixationMaterialSpec[]): boolean {
  return state.placed.length === specs.length;
}
