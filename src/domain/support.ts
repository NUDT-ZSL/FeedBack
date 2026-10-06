import type { MaterialCost, WorkshopState } from './types.ts';
import { MetalType } from './types.ts';
import { WorkshopError } from './errors.ts';

export function cloneState(state: WorkshopState): WorkshopState {
  return structuredClone(state);
}

export function validateMaterials(materials: MaterialCost[]): void {
  if (materials.length === 0) {
    throw new WorkshopError('EMPTY_MATERIALS', '纹样合成至少需要一种金属材料');
  }
  for (const cost of materials) {
    if (!Object.values(MetalType).includes(cost.metal)) {
      throw new WorkshopError('UNKNOWN_METAL', `未知金属类型: ${cost.metal}`);
    }
    if (!Number.isFinite(cost.amount) || cost.amount <= 0) {
      throw new WorkshopError(
        'INVALID_MATERIAL_AMOUNT',
        `材料数量必须为正数: ${cost.metal} = ${cost.amount}`,
      );
    }
  }
}

export function patternContentKey(name: string, materials: MaterialCost[]): string {
  const materialKey = [...materials]
    .sort((a, b) => a.metal.localeCompare(b.metal))
    .map((cost) => `${cost.metal}:${cost.amount}`)
    .join('|');
  return `${name}@@${materialKey}`;
}

let monotonicSequence = 0;

export function nextId(prefix: string): string {
  monotonicSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${monotonicSequence.toString(36)}`;
}
