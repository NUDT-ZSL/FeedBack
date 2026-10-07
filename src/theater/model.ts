import type {
  AttachmentPoint,
  BellNote,
  DanceAction,
  Joints,
  JointName,
  Prop,
  PropName,
  Puppet,
  PuppetName,
} from '../types.ts';

export type RecordingEventSource = 'live' | 'duplicate' | 'manual';

export interface SceneRecordingEvent {
  id: string;
  sceneId: string;
  note: BellNote;
  timestamp: number;
  source: RecordingEventSource;
}

export interface Scene {
  id: string;
  name: string;
  duration: number;
  puppets: Puppet[];
  props: Prop[];
  recording: SceneRecordingEvent[];
  createdAt: number;
}

export interface PuppetSpec {
  name: PuppetName;
  color: string;
}

export interface PropSpec {
  name: PropName;
}

export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 600;
export const PUPPET_WIDTH = 80;
export const PUPPET_HEIGHT = 120;
export const DEFAULT_SCENE_DURATION = 30_000;
export const MAX_PROPS_PER_PUPPET = 2;

export const PUPPET_SPECS: PuppetSpec[] = [
  { name: 'scholar', color: '#f5f0e6' },
  { name: 'general', color: '#1a1a1a' },
  { name: 'heroine', color: '#c0202a' },
  { name: 'clown', color: '#2a4fbf' },
];

export const PROP_SPECS: PropSpec[] = [
  { name: 'moneyBag' },
  { name: 'sword' },
  { name: 'fan' },
  { name: 'wineCup' },
  { name: 'letter' },
  { name: 'drum' },
];

export const ATTACHMENT_POINTS: AttachmentPoint[] = ['leftHand', 'rightHand', 'back'];

export function defaultJoints(): Joints {
  const joint = () => ({ angle: 0, animated: false });
  return {
    leftArm: joint(),
    rightArm: joint(),
    leftLeg: joint(),
    rightLeg: joint(),
    head: { rotation: 0 },
  };
}

export function createPuppet(spec: PuppetSpec, index: number): Puppet {
  return {
    id: `puppet-${spec.name}`,
    name: spec.name,
    color: spec.color,
    position: { x: 40 + index * 30, y: 60 + index * 140 },
    isOnStage: false,
    joints: defaultJoints(),
    props: [],
    danceAction: 'idle',
  };
}

export function createProp(spec: PropSpec, index: number): Prop {
  return {
    id: `prop-${spec.name}`,
    name: spec.name,
    position: { x: 20, y: 40 + index * 70 },
    attachedTo: null,
    attachmentPoint: null,
  };
}

export function createScene(id: string, name: string, createdAt: number): Scene {
  return {
    id,
    name,
    duration: DEFAULT_SCENE_DURATION,
    puppets: PUPPET_SPECS.map((spec, index) => createPuppet(spec, index)),
    props: PROP_SPECS.map((spec, index) => createProp(spec, index)),
    recording: [],
    createdAt,
  };
}

export function cloneJoints(joints: Joints): Joints {
  return {
    leftArm: { ...joints.leftArm },
    rightArm: { ...joints.rightArm },
    leftLeg: { ...joints.leftLeg },
    rightLeg: { ...joints.rightLeg },
    head: { ...joints.head },
  };
}

export function clonePuppet(puppet: Puppet): Puppet {
  return {
    ...puppet,
    position: { ...puppet.position },
    joints: cloneJoints(puppet.joints),
    props: puppet.props.map((prop) => ({ ...prop, position: { ...prop.position } })),
  };
}

export function cloneProp(prop: Prop): Prop {
  return { ...prop, position: { ...prop.position } };
}

export function cloneSceneForDuplicate(
  source: Scene,
  newSceneId: string,
  name: string,
  createdAt: number,
  eventId: (index: number) => string,
): Scene {
  return {
    id: newSceneId,
    name,
    duration: source.duration,
    puppets: source.puppets.map(clonePuppet),
    props: source.props.map(cloneProp),
    recording: source.recording.map((event, index) => ({
      ...event,
      id: eventId(index),
      sceneId: newSceneId,
      source: 'duplicate',
    })),
    createdAt,
  };
}

export const JOINT_NAMES: JointName[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export const DANCE_BY_NOTE: Record<BellNote, DanceAction> = {
  Do: 'bow',
  Re: 'bow',
  Mi: 'spin',
  Fa: 'spin',
  Sol: 'jump',
  La: 'jump',
  Si: 'jump',
};
