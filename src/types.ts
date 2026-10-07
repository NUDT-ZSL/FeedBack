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

export interface RecordingEvent {
  note: BellNote;
  timestamp: number;
}

export interface Recording {
  events: RecordingEvent[];
  startTime: number;
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
