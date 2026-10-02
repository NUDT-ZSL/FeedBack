export type StageId = 'mix' | 'form' | 'press' | 'dry' | 'inspect';

export const STAGE_ORDER: StageId[] = ['mix', 'form', 'press', 'dry', 'inspect'];

export const STAGE_LABELS: Record<StageId, string> = {
  mix: '配料',
  form: '抄纸',
  press: '压榨',
  dry: '晾晒',
  inspect: '检验',
};

export interface Recipe {
  bark: number;
  bamboo: number;
  water: number;
}

export type Operation =
  | { type: 'mix'; duration: number }
  | { type: 'form'; scoops: number }
  | { type: 'press'; force: number }
  | { type: 'dry'; ticks: number }
  | { type: 'inspect'; points: number };

export type BoundaryCode =
  | 'RECIPE_TOTAL_BELOW_MIN'
  | 'RECIPE_TOTAL_ABOVE_MAX'
  | 'MATERIAL_AMOUNT_NEGATIVE'
  | 'PRESS_FORCE_BELOW_MIN'
  | 'PRESS_FORCE_ABOVE_MAX'
  | 'INSPECT_BEFORE_DRY_COMPLETE'
  | 'INSPECT_POINTS_EXCEEDED'
  | 'STAGE_OUT_OF_ORDER'
  | 'STAGE_REPEATED'
  | 'OPERATION_IGNORED';

export interface BoundaryEvent {
  code: BoundaryCode;
  stage: StageId;
  message: string;
  detail?: Record<string, number | string | boolean>;
}

export interface Intermediates {
  concentration: number | null;
  uniformity: number | null;
  pressForce: number | null;
  pressEffective: boolean;
  dryness: number;
  inspectScore: number | null;
}

export type QualityRating = '甲' | '乙' | '丙' | '次品';

export interface FinalConclusion {
  rating: QualityRating;
  score: number | null;
  valid: boolean;
  reasons: string[];
}

export interface WorkshopState {
  recipe: Recipe;
  completed: StageId[];
  intermediates: Intermediates;
  events: BoundaryEvent[];
  acceptedInspectPoints: number;
  rejectedInspectPoints: number;
  defects: number;
  conclusion: FinalConclusion | null;
}

export interface StepResult {
  state: WorkshopState;
  events: BoundaryEvent[];
}

export interface HistoryRecordV2 {
  version: 2;
  id: string;
  createdAt: number;
  recipe: Recipe;
  operations: Operation[];
  conclusion: FinalConclusion;
  intermediates: Intermediates;
  events: BoundaryEvent[];
}

export type LegacyHistoryRecord = {
  version?: undefined | 1;
  id?: string;
  time?: number;
  createdAt?: number;
  score?: number;
  level?: string;
  rating?: string;
  recipe?: Partial<Recipe>;
};

export type AnyHistoryRecord = LegacyHistoryRecord | HistoryRecordV2;
