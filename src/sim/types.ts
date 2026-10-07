import type { Vec2 } from './geometry';

/** 阵型类型：雁行阵(V)、鱼鳞阵(菱形)、偃月阵(弧形)。 */
export type FormationType = 'yanxing' | 'yulin' | 'yanyue';

export type CommandKind = 'turn' | 'formation' | 'speed' | 'disperse';

export type DetachCause = 'reef' | 'damage';

export interface ShipSpec {
  id: string;
  pos: Vec2;
  heading: number;
  speed: number;
  maxSpeed: number;
}

export interface ShipState extends ShipSpec {
  fleetId: string | null;
  active: boolean;
}

export interface FleetSpec {
  id: string;
  /** 成员名册，顺序即资历顺序（旗舰移交的预设规则依据）。 */
  roster: string[];
  flagshipId: string;
  formation: FormationType;
  ships: ShipSpec[];
}

/** 编队指令：携带下达时刻 issuedAt 与执行时长 duration。 */
export interface FleetCommand {
  id: string;
  fleetId: string;
  kind: CommandKind;
  issuedAt: number;
  duration: number;
  /** turn：相对转向角（弧度，正为左转）。 */
  headingDelta?: number;
  /** speed：目标航速。 */
  targetSpeed?: number;
  /** formation：目标阵型。 */
  formation?: FormationType;
  /** disperse：散开倍率（相对当前阵型依据放大），默认 2。 */
  disperseScale?: number;
}

export type CommandStatus = 'executed' | 'truncated' | 'superseded';

/** 冲突消解后的有效指令：实际执行窗口 [start, end)。 */
export interface EffectiveCommand extends FleetCommand {
  start: number;
  end: number;
  status: CommandStatus;
  /** 覆盖本指令未执行部分的后续指令 id。 */
  overriddenBy?: string;
}

export interface SimEvent {
  time: number;
  type: 'detach';
  fleetId: string;
  shipId: string;
  cause: DetachCause;
}

export type SnapshotReason =
  | 'formation-before'
  | 'formation-after'
  | 'disperse-before'
  | 'disperse-after'
  | 'reslot'
  | 'flagship-handover'
  | 'detach';

export interface SnapshotMember {
  shipId: string;
  pos: Vec2;
  heading: number;
  /** 旗舰本地坐标系下的相对偏移（阵型依据）。 */
  offset: Vec2;
  distToFlagship: number;
  bearingToFlagship: number;
}

/** 队形快照：变阵前后、补位、旗舰移交时记录，可回看对照。 */
export interface FormationSnapshot {
  fleetId: string;
  time: number;
  reason: SnapshotReason;
  commandId?: string;
  flagshipId: string;
  formation: FormationType | 'disperse';
  /** 快照是否对应一条被截断的指令（未执行完）。 */
  truncated?: boolean;
  /** 旗舰归属依据（移交时记录）。 */
  handover?: {
    previousFlagshipId: string;
    rule: 'seniority';
    cause: DetachCause;
  };
  members: SnapshotMember[];
}

export interface EventRecord {
  time: number;
  type: 'detach' | 'reslot' | 'flagship-handover';
  fleetId: string;
  shipId?: string;
  detail: string;
}

export interface FleetSample {
  time: number;
  ships: ShipState[];
}
