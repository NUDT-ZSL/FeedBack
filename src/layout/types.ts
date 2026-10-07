export type Axis = 'x' | 'y';
export type AlignEdge = 'min' | 'max';
export type Orientation = 'normal' | 'rotated';

export interface Range1D {
  min: number;
  max: number;
}

export interface Block {
  id: string;
  width: number;
  height: number;
  rotatable: boolean;
  xRange: Range1D;
  yRange: Range1D;
}

export interface AdjacentConstraint {
  id: string;
  type: 'adjacent';
  a: string;
  b: string;
  axis: Axis;
  gap: number;
}

export interface AlignConstraint {
  id: string;
  type: 'align';
  a: string;
  b: string;
  axis: Axis;
  edge: AlignEdge;
}

export interface MutexConstraint {
  id: string;
  type: 'mutex';
  a: string;
  b: string;
}

export interface ContainConstraint {
  id: string;
  type: 'contain';
  container: string;
  content: string;
}

export type Constraint =
  | AdjacentConstraint
  | AlignConstraint
  | MutexConstraint
  | ContainConstraint;

export interface Placement {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: Orientation;
}

export type LayoutIssueCode =
  | 'duplicate_block_id'
  | 'duplicate_constraint_id'
  | 'invalid_dimension'
  | 'invalid_range'
  | 'missing_reference'
  | 'self_reference'
  | 'constraint_cycle'
  | 'no_feasible_placement'
  | 'incremental_conflict';

export interface LayoutIssue {
  code: LayoutIssueCode;
  message: string;
  blockIds: string[];
  constraintIds: string[];
}

export interface MutexBlocker {
  constraintId: string;
  other: string;
}

export interface MutexConflict {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: Orientation;
  blockers: MutexBlocker[];
}

export interface SolveOptions {
  pinned?: ReadonlyMap<string, Placement>;
  waivedMutex?: ReadonlySet<string>;
}

export type SolveStatus = 'satisfied' | 'unsatisfiable' | 'adjudication_required';

export interface SolveResult {
  status: SolveStatus;
  placements: Map<string, Placement>;
  issues: LayoutIssue[];
  conflicts: MutexConflict[];
}

export interface LayoutInput {
  blocks: Block[];
  constraints: Constraint[];
}

export interface BlockPatch {
  id: string;
  width?: number;
  height?: number;
  rotatable?: boolean;
  xRange?: Range1D;
  yRange?: Range1D;
}

export interface LayoutPatch {
  blocks?: BlockPatch[];
  addConstraints?: Constraint[];
  removeConstraintIds?: string[];
  enforceMutex?: string[];
  waiveMutex?: string[];
}

export type UpdateScope = 'unchanged' | 'incremental' | 'full';

export interface UpdateResult extends SolveResult {
  scope: UpdateScope;
  affectedBlockIds: string[];
  consistentWithFullSolve: boolean;
}
