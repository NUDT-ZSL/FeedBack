import type { AttachmentPoint, BellNote, DanceAction, PropName, PuppetName } from '../types';

export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 600;
export const STAGE_BG = '#400000';
export const BACKLIGHT_COLOR = '#ffaa00';

export const PUPPET_WIDTH = 80;
export const PUPPET_HEIGHT = 120;

export const PROP_WIDTH = 60;
export const PROP_HEIGHT = 40;

/** 同一影人最多携带 2 个道具 */
export const MAX_PROPS_PER_PUPPET = 2;

/** 单次录制最长 30 秒 */
export const MAX_RECORDING_MS = 30_000;

export interface PuppetSpec {
  name: PuppetName;
  label: string;
  color: string;
}

export const PUPPET_SPECS: PuppetSpec[] = [
  { name: 'scholar', label: '书生', color: '#f5f5f0' },
  { name: 'general', label: '武将', color: '#111111' },
  { name: 'heroine', label: '花旦', color: '#c0302a' },
  { name: 'clown', label: '小丑', color: '#2b5fd9' },
];

export interface PropSpec {
  name: PropName;
  label: string;
  /** 拖到影人身上时的默认挂载点 */
  defaultPoint: AttachmentPoint;
}

export const PROP_SPECS: PropSpec[] = [
  { name: 'moneyBag', label: '钱袋', defaultPoint: 'back' },
  { name: 'sword', label: '长剑', defaultPoint: 'rightHand' },
  { name: 'fan', label: '团扇', defaultPoint: 'leftHand' },
  { name: 'wineCup', label: '酒杯', defaultPoint: 'rightHand' },
  { name: 'letter', label: '书信', defaultPoint: 'leftHand' },
  { name: 'drum', label: '锣鼓', defaultPoint: 'back' },
];

export const NOTES: BellNote[] = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];

/** 回放联动：高音跳跃、中音旋转、低音鞠躬 */
export function danceActionForNote(note: BellNote): DanceAction {
  switch (note) {
    case 'Sol':
    case 'La':
    case 'Si':
      return 'jump';
    case 'Mi':
    case 'Fa':
      return 'spin';
    case 'Do':
    case 'Re':
      return 'bow';
  }
}
