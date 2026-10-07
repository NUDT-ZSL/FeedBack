export type PuppetName = 'scholar' | 'general' | 'heroine' | 'clown';
export type PropName = 'moneyBag' | 'sword' | 'fan' | 'wineCup' | 'letter' | 'drum';
export type BellNote = 'Do' | 'Re' | 'Mi' | 'Fa' | 'Sol' | 'La' | 'Si';
export type AttachmentPoint = 'leftHand' | 'rightHand' | 'back';
export type DanceAction = 'idle' | 'jump' | 'spin' | 'bow';
export type JointName = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export interface JointState {
  angle: number;
  animated: boolean;
}

export interface Joints {
  leftArm: JointState;
  rightArm: JointState;
  leftLeg: JointState;
  rightLeg: JointState;
  head: { rotation: number };
}

export interface Puppet {
  id: string;
  name: PuppetName;
  color: string;
  position: { x: number; y: number };
  isOnStage: boolean;
  joints: Joints;
  /** 影人随身携带的道具（与道具账本 Prop.attachedTo 互为镜像，校验器负责比对两侧） */
  props: Prop[];
  danceAction: DanceAction;
}

export interface Prop {
  id: string;
  name: PropName;
  position: { x: number; y: number };
  attachedTo: string | null;
  attachmentPoint: AttachmentPoint | null;
}

export interface Bell {
  id: string;
  note: BellNote;
  frequency: number;
  isActive: boolean;
  ripple: boolean;
}

/** 录音事件来源：现场录制 / 从其他场次复制而来 */
export type EventSource = 'recorded' | 'duplicated';

export interface RecordingEvent {
  id: string;
  /** 所属场次 id，回放与校验均以此隔离 */
  showId: string;
  note: BellNote;
  /** 相对录制起点的毫秒偏移 */
  timestamp: number;
  source: EventSource;
}

export interface Recording {
  events: RecordingEvent[];
  startTime: number;
  /** 毫秒 */
  duration: number;
}

/** 一场演出（场次）的完整可还原状态 */
export interface ShowState {
  id: string;
  name: string;
  createdAt: number;
  puppets: Puppet[];
  props: Prop[];
  recording: Recording;
  /** 场次时长（毫秒），录音事件时刻必须落在 [0, duration] 内 */
  duration: number;
}

export interface ShowSummary {
  id: string;
  name: string;
  puppetCount: number;
  onStageCount: number;
  attachedPropCount: number;
  eventCount: number;
  duration: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
}

export type ValidationIssueType =
  | 'puppet-out-of-stage'
  | 'attachment-target-missing'
  | 'mount-conflict'
  | 'recording-event-out-of-duration'
  | 'foreign-recording-event'
  | 'puppet-over-capacity';

export interface ValidationEvidence {
  objectId: string;
  objectKind: 'puppet' | 'prop' | 'recording-event';
  detail: string;
}

export interface ValidationIssue {
  type: ValidationIssueType;
  severity: 'error' | 'warning';
  showId: string;
  showName: string;
  /** 主要涉事对象 id */
  objectId: string;
  message: string;
  /** 冲突类问题保留双方（或多方）依据，不静默择一 */
  evidence: ValidationEvidence[];
}
