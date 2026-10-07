import type { AttachmentPoint, BellNote, DanceAction, JointName } from '../types.ts';
import {
  ATTACHMENT_POINTS,
  DANCE_BY_NOTE,
  MAX_PROPS_PER_PUPPET,
  cloneSceneForDuplicate,
  createScene,
  type Scene,
  type SceneRecordingEvent,
} from './model.ts';
import { ValidationCache, validateScenes, type SceneValidationReport } from './validation.ts';

export interface TheaterSnapshot {
  scenes: Scene[];
  activeSceneId: string;
  isRecording: boolean;
  isPlaying: boolean;
  playingSceneId: string | null;
}

export interface PlaybackDriver {
  now(): number;
  schedule(delayMs: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
  playNote(note: BellNote): void;
}

export const browserPlaybackDriver = (playNote: (note: BellNote) => void): PlaybackDriver => ({
  now: () => performance.now(),
  schedule: (delayMs, fn) => setTimeout(fn, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  playNote,
});

interface RecordingSession {
  sceneId: string;
  startedAt: number;
}

interface PlaybackSession {
  token: number;
  sceneId: string;
  handles: unknown[];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export class TheaterStore {
  private driver: PlaybackDriver;
  private scenes = new Map<string, Scene>();
  private order: string[] = [];
  private activeSceneId: string;
  private listeners = new Set<() => void>();
  private validationCache = new ValidationCache();
  private recording: RecordingSession | null = null;
  private playback: PlaybackSession | null = null;
  private playbackToken = 0;
  private eventCounter = 0;
  private cachedSnapshot: TheaterSnapshot | null = null;

  constructor(driver: PlaybackDriver) {
    this.driver = driver;
    const scene = createScene(nextId('scene'), '第一场', driver.now());
    this.scenes.set(scene.id, scene);
    this.order.push(scene.id);
    this.activeSceneId = scene.id;
    this.validationCache.markDirty(scene.id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  private touch(sceneId: string): void {
    this.validationCache.markDirty(sceneId);
  }

  markSceneDirty(sceneId = this.activeSceneId): void {
    this.touch(sceneId);
  }

  getSnapshot(): TheaterSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    this.cachedSnapshot = {
      scenes: this.order.map((id) => this.scenes.get(id) as Scene),
      activeSceneId: this.activeSceneId,
      isRecording: this.recording !== null,
      isPlaying: this.playback !== null,
      playingSceneId: this.playback?.sceneId ?? null,
    };
    return this.cachedSnapshot;
  }

  getActiveScene(): Scene {
    return this.scenes.get(this.activeSceneId) as Scene;
  }

  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  createScene(name?: string): string {
    const scene = createScene(
      nextId('scene'),
      name ?? `第${this.order.length + 1}场`,
      this.driver.now(),
    );
    this.scenes.set(scene.id, scene);
    this.order.push(scene.id);
    this.touch(scene.id);
    this.emit();
    return scene.id;
  }

  duplicateScene(sourceId: string, name?: string): string {
    const source = this.scenes.get(sourceId);
    if (!source) throw new Error(`场次不存在: ${sourceId}`);
    const newId = nextId('scene');
    const sourceIndex = this.order.indexOf(sourceId);
    const copy = cloneSceneForDuplicate(
      source,
      newId,
      name ?? `${source.name} 副本`,
      this.driver.now(),
      (index) => this.newEventId(index),
    );
    this.scenes.set(newId, copy);
    this.order.splice(sourceIndex + 1, 0, newId);
    this.touch(newId);
    this.emit();
    return newId;
  }

  deleteScene(sceneId: string): void {
    if (!this.scenes.has(sceneId)) throw new Error(`场次不存在: ${sceneId}`);
    if (this.order.length <= 1) throw new Error('至少保留一场演出');
    if (this.playback?.sceneId === sceneId) this.stopPlayback();
    if (this.recording?.sceneId === sceneId) this.recording = null;
    this.scenes.delete(sceneId);
    this.order = this.order.filter((id) => id !== sceneId);
    this.validationCache.drop(sceneId);
    if (this.activeSceneId === sceneId) {
      this.activeSceneId = this.order[0];
    }
    this.emit();
  }

  switchScene(sceneId: string): void {
    if (!this.scenes.has(sceneId)) throw new Error(`场次不存在: ${sceneId}`);
    if (sceneId === this.activeSceneId) return;
    this.stopPlayback();
    if (this.recording) this.recording = null;
    this.activeSceneId = sceneId;
    this.emit();
  }

  renameScene(sceneId: string, name: string): void {
    const scene = this.mustScene(sceneId);
    scene.name = name;
    this.emit();
  }

  setSceneDuration(durationMs: number, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    scene.duration = durationMs;
    this.touch(scene.id);
    this.emit();
  }

  private mustScene(sceneId: string): Scene {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(`场次不存在: ${sceneId}`);
    return scene;
  }

  private mustPuppet(scene: Scene, puppetId: string) {
    const puppet = scene.puppets.find((item) => item.id === puppetId);
    if (!puppet) throw new Error(`影人不存在: ${puppetId}`);
    return puppet;
  }

  private mustProp(scene: Scene, propId: string) {
    const prop = scene.props.find((item) => item.id === propId);
    if (!prop) throw new Error(`道具不存在: ${propId}`);
    return prop;
  }

  movePuppet(puppetId: string, x: number, y: number, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    const puppet = this.mustPuppet(scene, puppetId);
    puppet.position = { x, y };
    this.touch(scene.id);
    this.emit();
  }

  setPuppetOnStage(puppetId: string, isOnStage: boolean, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    const puppet = this.mustPuppet(scene, puppetId);
    puppet.isOnStage = isOnStage;
    this.touch(scene.id);
    this.emit();
  }

  setJoint(puppetId: string, joint: JointName, angle: number, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    const puppet = this.mustPuppet(scene, puppetId);
    puppet.joints[joint].angle = angle;
    puppet.joints[joint].animated = true;
    puppet.joints.head.rotation = angle !== 0 ? 5 : 0;
    this.touch(scene.id);
    this.emit();
  }

  setDanceAction(puppetId: string, action: DanceAction, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    const puppet = this.mustPuppet(scene, puppetId);
    puppet.danceAction = action;
    this.touch(scene.id);
    this.emit();
  }

  attachProp(
    propId: string,
    puppetId: string,
    point: AttachmentPoint,
    sceneId = this.activeSceneId,
  ): void {
    if (!ATTACHMENT_POINTS.includes(point)) throw new Error(`非法挂载点: ${point}`);
    const scene = this.mustScene(sceneId);
    const prop = this.mustProp(scene, propId);
    const target = this.mustPuppet(scene, puppetId);

    const holder = scene.puppets.find((puppet) => puppet.props.some((held) => held.id === propId));
    if (holder && holder.id !== target.id) {
      holder.props = holder.props.filter((held) => held.id !== propId);
    }

    const occupied = target.props.some(
      (held) => held.id !== propId && held.attachmentPoint === point,
    );
    if (occupied) throw new Error(`挂载点 ${point} 已被占用`);

    const alreadyHeld = target.props.some((held) => held.id === propId);
    if (!alreadyHeld && target.props.length >= MAX_PROPS_PER_PUPPET) {
      throw new Error(`影人 ${target.name} 最多携带 ${MAX_PROPS_PER_PUPPET} 个道具`);
    }

    target.props = target.props.filter((held) => held.id !== propId);
    target.props.push({ ...prop, attachedTo: target.id, attachmentPoint: point });
    prop.attachedTo = target.id;
    prop.attachmentPoint = point;
    this.touch(scene.id);
    this.emit();
  }

  detachProp(propId: string, sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    const prop = this.mustProp(scene, propId);
    for (const puppet of scene.puppets) {
      puppet.props = puppet.props.filter((held) => held.id !== propId);
    }
    prop.attachedTo = null;
    prop.attachmentPoint = null;
    this.touch(scene.id);
    this.emit();
  }

  private newEventId(index = 0): string {
    this.eventCounter += 1;
    return `event-${this.eventCounter.toString(36)}-${index.toString(36)}`;
  }

  startRecording(sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    this.stopPlayback();
    this.recording = { sceneId: scene.id, startedAt: this.driver.now() };
    this.emit();
  }

  recordEvent(note: BellNote, timestamp?: number): SceneRecordingEvent {
    if (!this.recording) throw new Error('当前没有进行中的录制');
    const scene = this.mustScene(this.recording.sceneId);
    const event: SceneRecordingEvent = {
      id: this.newEventId(),
      sceneId: scene.id,
      note,
      timestamp: timestamp ?? Math.max(0, this.driver.now() - this.recording.startedAt),
      source: 'live',
    };
    scene.recording.push(event);
    scene.recording.sort((a, b) => a.timestamp - b.timestamp);
    this.touch(scene.id);
    this.emit();
    return event;
  }

  stopRecording(): void {
    this.recording = null;
    this.emit();
  }

  clearRecording(sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    if (this.playback?.sceneId === scene.id) this.stopPlayback();
    if (this.recording?.sceneId === scene.id) this.recording = null;
    scene.recording = [];
    this.touch(scene.id);
    this.emit();
  }

  playScene(sceneId = this.activeSceneId): void {
    const scene = this.mustScene(sceneId);
    this.stopPlayback();
    this.recording = null;
    this.playbackToken += 1;
    const token = this.playbackToken;
    const session: PlaybackSession = { token, sceneId: scene.id, handles: [] };
    this.playback = session;

    const events = [...scene.recording].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of events) {
      if (event.sceneId !== scene.id) continue;
      const handle = this.driver.schedule(event.timestamp, () => {
        if (this.playback?.token !== token) return;
        this.driver.playNote(event.note);
        for (const puppet of scene.puppets) {
          puppet.danceAction = DANCE_BY_NOTE[event.note];
        }
        this.emit();
      });
      session.handles.push(handle);
    }
    const done = this.driver.schedule(scene.duration, () => {
      if (this.playback?.token !== token) return;
      this.stopPlayback();
    });
    session.handles.push(done);
    this.emit();
  }

  stopPlayback(): void {
    if (!this.playback) return;
    for (const handle of this.playback.handles) this.driver.cancel(handle);
    this.playbackToken += 1;
    this.playback = null;
    this.emit();
  }

  validateActiveScene(): SceneValidationReport {
    return this.validateAll().find((report) => report.sceneId === this.activeSceneId) as SceneValidationReport;
  }

  validateAll(): SceneValidationReport[] {
    return validateScenes(this.order.map((id) => this.scenes.get(id) as Scene));
  }

  revalidateDirty(): SceneValidationReport[] {
    return this.validationCache.revalidate(
      this.order.map((id) => this.scenes.get(id) as Scene),
    );
  }
}
