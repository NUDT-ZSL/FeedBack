import type {
  AttachmentPoint,
  BellNote,
  DanceAction,
  JointName,
  Prop,
  Puppet,
  RecordingEvent,
  ShowState,
  ShowSummary,
} from '../types';
import {
  MAX_PROPS_PER_PUPPET,
  MAX_RECORDING_MS,
  PROP_SPECS,
  PUPPET_SPECS,
} from './constants';
import { PlaybackController } from './playback';

export interface AttachResult {
  ok: boolean;
  reason?: string;
}

let idCounter = 0;
function defaultIdGen(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function makePuppets(): Puppet[] {
  return PUPPET_SPECS.map((spec, i) => ({
    id: `puppet-${spec.name}`,
    name: spec.name,
    color: spec.color,
    position: { x: 0, y: i * 130 },
    isOnStage: false,
    joints: {
      leftArm: { angle: 0, animated: false },
      rightArm: { angle: 0, animated: false },
      leftLeg: { angle: 0, animated: false },
      rightLeg: { angle: 0, animated: false },
      head: { rotation: 0 },
    },
    props: [],
    danceAction: 'idle',
  }));
}

function makeProps(): Prop[] {
  return PROP_SPECS.map((spec, i) => ({
    id: `prop-${spec.name}`,
    name: spec.name,
    position: { x: 0, y: i * 56 },
    attachedTo: null,
    attachmentPoint: null,
  }));
}

/**
 * 多场次存储：每场演出独立保存影人位姿、道具账本与录音序列。
 * 所有 mutation 之后触发订阅通知，UI 层据此整体重渲染当前场次。
 */
export class ShowStore {
  private shows = new Map<string, ShowState>();
  private activeShowId: string;
  private listeners = new Set<() => void>();
  private recordingShowId: string | null = null;
  readonly playback: PlaybackController;

  constructor(
    private idGen: (prefix: string) => string = defaultIdGen,
    private now: () => number = () => Date.now(),
    playback?: PlaybackController,
  ) {
    this.playback = playback ?? new PlaybackController();
    const first = this.buildShow('第一场');
    this.shows.set(first.id, first);
    this.activeShowId = first.id;
  }

  // ---------- 订阅 ----------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // ---------- 查询 ----------

  get activeShow(): ShowState {
    const show = this.shows.get(this.activeShowId);
    if (!show) throw new Error('active show missing');
    return show;
  }

  get activeId(): string {
    return this.activeShowId;
  }

  get isRecording(): boolean {
    return this.recordingShowId !== null;
  }

  getShow(id: string): ShowState | undefined {
    return this.shows.get(id);
  }

  listShows(): ShowSummary[] {
    return [...this.shows.values()].map((s) => ({
      id: s.id,
      name: s.name,
      puppetCount: s.puppets.length,
      onStageCount: s.puppets.filter((p) => p.isOnStage).length,
      attachedPropCount: s.props.filter((p) => p.attachedTo !== null).length,
      eventCount: s.recording.events.length,
      duration: s.duration,
    }));
  }

  allShows(): ShowState[] {
    return [...this.shows.values()];
  }

  // ---------- 场次管理 ----------

  private buildShow(name: string): ShowState {
    return {
      id: this.idGen('show'),
      name,
      createdAt: this.now(),
      puppets: makePuppets(),
      props: makeProps(),
      recording: { events: [], startTime: 0, duration: 0 },
      duration: 0,
    };
  }

  createShow(name?: string): ShowState {
    const show = this.buildShow(name ?? `第${this.shows.size + 1}场`);
    this.shows.set(show.id, show);
    this.switchShow(show.id);
    return show;
  }

  /** 复制某场作为新场次起点：深拷贝位姿与账本，录音事件重新归属新场次并标记来源 */
  duplicateShow(sourceId: string, name?: string): ShowState {
    const src = this.shows.get(sourceId);
    if (!src) throw new Error(`show not found: ${sourceId}`);
    const copy: ShowState = structuredClone(src);
    copy.id = this.idGen('show');
    copy.name = name ?? `${src.name} 副本`;
    copy.createdAt = this.now();
    copy.recording.events = copy.recording.events.map((ev) => ({
      ...ev,
      id: this.idGen('event'),
      showId: copy.id,
      source: 'duplicated' as const,
    }));
    this.shows.set(copy.id, copy);
    this.switchShow(copy.id);
    return copy;
  }

  /** 删除场次：只清理该场次的道具归属与录音事件，其他场次原样保留 */
  deleteShow(id: string): void {
    if (!this.shows.has(id)) return;
    if (this.playback.playingShowId === id) this.playback.interrupt();
    if (this.recordingShowId === id) this.recordingShowId = null;
    this.shows.delete(id);
    if (this.shows.size === 0) {
      const fresh = this.buildShow('第一场');
      this.shows.set(fresh.id, fresh);
    }
    if (this.activeShowId === id) {
      this.activeShowId = [...this.shows.keys()][0];
    }
    this.playback.interrupt();
    this.notify();
  }

  /** 切换场次：安全中断回放与录制，完整还原目标场次状态 */
  switchShow(id: string): ShowState {
    const target = this.shows.get(id);
    if (!target) throw new Error(`show not found: ${id}`);
    this.playback.interrupt();
    this.recordingShowId = null;
    this.activeShowId = id;
    this.notify();
    return target;
  }

  renameShow(id: string, name: string): void {
    const show = this.shows.get(id);
    if (!show) return;
    show.name = name;
    this.notify();
  }

  // ---------- 影人 ----------

  movePuppet(puppetId: string, x: number, y: number, isOnStage: boolean): void {
    const puppet = this.activeShow.puppets.find((p) => p.id === puppetId);
    if (!puppet) return;
    puppet.position = { x, y };
    puppet.isOnStage = isOnStage;
    this.notify();
  }

  toggleJoint(puppetId: string, joint: JointName): void {
    const puppet = this.activeShow.puppets.find((p) => p.id === puppetId);
    if (!puppet) return;
    const state = puppet.joints[joint];
    const raised = joint === 'leftArm' || joint === 'rightArm' ? -90 : -45;
    state.angle = state.angle === 0 ? raised : 0;
    state.animated = true;
    puppet.joints.head.rotation = state.angle === 0 ? 0 : 5;
    this.notify();
  }

  setDanceActionForOnStage(action: DanceAction): void {
    for (const puppet of this.activeShow.puppets) {
      if (puppet.isOnStage) puppet.danceAction = action;
    }
    this.notify();
  }

  // ---------- 道具账本 ----------

  /**
   * 把道具挂到当前场次某影人的挂载点。
   * 账本（Prop.attachedTo/attachmentPoint）与影人携带列表同步更新；
   * 同一影人最多携带 MAX_PROPS_PER_PUPPET 个道具。
   */
  attachProp(propId: string, puppetId: string, point: AttachmentPoint): AttachResult {
    const show = this.activeShow;
    const prop = show.props.find((p) => p.id === propId);
    const puppet = show.puppets.find((p) => p.id === puppetId);
    if (!prop) return { ok: false, reason: `道具不存在: ${propId}` };
    if (!puppet) return { ok: false, reason: `影人不存在: ${puppetId}` };

    if (prop.attachedTo && prop.attachedTo !== puppetId) {
      const prev = show.puppets.find((p) => p.id === prop.attachedTo);
      if (prev) prev.props = prev.props.filter((p) => p.id !== propId);
    }

    const alreadyCarried = puppet.props.some((p) => p.id === propId);
    if (!alreadyCarried && puppet.props.length >= MAX_PROPS_PER_PUPPET) {
      return {
        ok: false,
        reason: `影人 ${puppet.name} 最多携带 ${MAX_PROPS_PER_PUPPET} 个道具`,
      };
    }

    prop.attachedTo = puppetId;
    prop.attachmentPoint = point;
    if (!alreadyCarried) puppet.props.push(prop);
    this.notify();
    return { ok: true };
  }

  detachProp(propId: string): void {
    const show = this.activeShow;
    const prop = show.props.find((p) => p.id === propId);
    if (!prop || prop.attachedTo === null) return;
    const owner = show.puppets.find((p) => p.id === prop.attachedTo);
    if (owner) owner.props = owner.props.filter((p) => p.id !== propId);
    prop.attachedTo = null;
    prop.attachmentPoint = null;
    this.notify();
  }

  // ---------- 锣鼓录音 ----------

  startRecording(): void {
    const show = this.activeShow;
    this.playback.interrupt();
    show.recording = { events: [], startTime: this.now(), duration: 0 };
    show.duration = 0;
    this.recordingShowId = show.id;
    this.notify();
  }

  /** 录制一个音符，事件自动带上当前场次归属与来源标记 */
  recordNote(note: BellNote, atMs?: number): RecordingEvent | null {
    if (this.recordingShowId === null) return null;
    const show = this.shows.get(this.recordingShowId);
    if (!show) return null;
    const at = atMs ?? this.now();
    const timestamp = Math.max(0, at - show.recording.startTime);
    if (timestamp > MAX_RECORDING_MS) return null;
    const event: RecordingEvent = {
      id: this.idGen('event'),
      showId: show.id,
      note,
      timestamp,
      source: 'recorded',
    };
    show.recording.events.push(event);
    show.recording.duration = Math.max(show.recording.duration, timestamp);
    show.duration = show.recording.duration;
    this.notify();
    return event;
  }

  stopRecording(atMs?: number): void {
    if (this.recordingShowId === null) return;
    const show = this.shows.get(this.recordingShowId);
    if (show) {
      const at = atMs ?? this.now();
      const duration = Math.min(
        MAX_RECORDING_MS,
        Math.max(show.recording.duration, at - show.recording.startTime),
      );
      show.recording.events = show.recording.events.filter(
        (ev) => ev.timestamp <= duration,
      );
      show.recording.duration = duration;
      show.duration = duration;
    }
    this.recordingShowId = null;
    this.notify();
  }

  /** 回放当前场次的录音序列（只含本场次事件） */
  playActiveShow(sink: {
    playNote(note: BellNote): void;
    onDance?(action: DanceAction): void;
    onFinish?(): void;
  }): void {
    if (this.recordingShowId !== null) this.stopRecording();
    this.playback.start(this.activeShow, sink);
  }
}
