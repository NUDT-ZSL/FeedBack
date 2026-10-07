import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BellNote } from '../types.ts';
import type { PlaybackDriver } from './store.ts';
import { TheaterStore } from './store.ts';
import { STAGE_WIDTH, STAGE_HEIGHT, PUPPET_WIDTH, PUPPET_HEIGHT } from './model.ts';

interface QueuedTimer {
  due: number;
  fn: () => void;
  cancelled: boolean;
}

class FakeDriver implements PlaybackDriver {
  clock = 0;
  timers: QueuedTimer[] = [];
  played: BellNote[] = [];
  now(): number {
    return this.clock;
  }
  schedule(delayMs: number, fn: () => void): unknown {
    const timer = { due: this.clock + delayMs, fn, cancelled: false };
    this.timers.push(timer);
    return timer;
  }
  cancel(handle: unknown): void {
    (handle as QueuedTimer).cancelled = true;
  }
  playNote(note: BellNote): void {
    this.played.push(note);
  }
  advance(ms: number): void {
    const limit = this.clock + ms;
    while (true) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.due <= limit)
        .sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      due.cancelled = true;
      this.clock = due.due;
      due.fn();
    }
    this.clock = limit;
  }
}

function makeStore(): { store: TheaterStore; driver: FakeDriver } {
  const driver = new FakeDriver();
  const store = new TheaterStore(driver);
  return { store, driver };
}

const GENERAL = 'puppet-general';
const HEROINE = 'puppet-heroine';
const SWORD = 'prop-sword';

test('场次切换/复制/删除：状态各自隔离，切换后完整还原', () => {
  const { store } = makeStore();
  const sceneA = store.getActiveScene().id;

  store.movePuppet(GENERAL, 500, 300);
  store.setPuppetOnStage(GENERAL, true);
  store.setJoint(GENERAL, 'rightArm', 90);
  store.attachProp(SWORD, GENERAL, 'rightHand');

  const sceneB = store.createScene('第二场');
  store.switchScene(sceneB);

  const generalB = store.getActiveScene().puppets.find((p) => p.id === GENERAL)!;
  assert.equal(generalB.isOnStage, false);
  assert.equal(generalB.position.x, 70);
  assert.equal(generalB.props.length, 0);
  assert.equal(generalB.joints.rightArm.angle, 0);

  store.movePuppet(HEROINE, 300, 200);
  store.attachProp(SWORD, HEROINE, 'leftHand');

  store.switchScene(sceneA);
  const sceneAState = store.getActiveScene();
  const generalA = sceneAState.puppets.find((p) => p.id === GENERAL)!;
  assert.equal(generalA.position.x, 500);
  assert.equal(generalA.isOnStage, true);
  assert.equal(generalA.joints.rightArm.angle, 90);
  assert.deepEqual(
    [generalA.props[0].id, generalA.props[0].attachmentPoint],
    [SWORD, 'rightHand'],
  );
  assert.equal(sceneAState.props.find((pr) => pr.id === SWORD)!.attachedTo, GENERAL);
  const heroineA = sceneAState.puppets.find((p) => p.id === HEROINE)!;
  assert.equal(heroineA.position.x, 100, 'B 场的影人位移不能残留到 A 场');
  assert.equal(heroineA.props.length, 0);

  const sceneC = store.duplicateScene(sceneA, '第三场');
  store.switchScene(sceneC);
  const generalC = store.getActiveScene().puppets.find((p) => p.id === GENERAL)!;
  assert.equal(generalC.position.x, 500);
  assert.equal(generalC.props[0].attachmentPoint, 'rightHand');
  store.movePuppet(GENERAL, 10, 10);
  store.switchScene(sceneA);
  assert.equal(store.getActiveScene().puppets.find((p) => p.id === GENERAL)!.position.x, 500);

  store.deleteScene(sceneB);
  assert.equal(store.getSnapshot().scenes.length, 2);
  store.switchScene(sceneA);
  assert.equal(store.getActiveScene().id, sceneA);
});

test('道具账本：跨场次归属互不影响，删场只清本场', () => {
  const { store } = makeStore();
  const sceneA = store.getActiveScene().id;
  store.attachProp(SWORD, GENERAL, 'rightHand');

  const sceneB = store.createScene('第二场');
  store.switchScene(sceneB);
  store.attachProp(SWORD, HEROINE, 'leftHand');

  store.switchScene(sceneA);
  const swordA = store.getActiveScene().props.find((pr) => pr.id === SWORD)!;
  assert.deepEqual(
    [swordA.attachedTo, swordA.attachmentPoint],
    [GENERAL, 'rightHand'],
    '切回 A 场必须还原原始挂载关系',
  );
  assert.equal(store.getActiveScene().puppets.find((p) => p.id === HEROINE)!.props.length, 0);

  store.switchScene(sceneB);
  const swordB = store.getActiveScene().props.find((pr) => pr.id === SWORD)!;
  assert.deepEqual([swordB.attachedTo, swordB.attachmentPoint], [HEROINE, 'leftHand']);

  store.detachProp(SWORD);
  store.switchScene(sceneA);
  assert.equal(
    store.getActiveScene().props.find((pr) => pr.id === SWORD)!.attachedTo,
    GENERAL,
    '在 B 场取下道具不能影响 A 场',
  );

  store.startRecording();
  store.recordEvent('Do', 500);
  store.deleteScene(sceneA);
  store.switchScene(sceneB);
  assert.equal(
    store.getActiveScene().props.find((pr) => pr.id === SWORD)!.attachedTo,
    null,
    '删除 A 场不应复活 B 场已取下的道具',
  );
  assert.equal(store.getActiveScene().recording.length, 0);
});

test('录音事件带场次归属，复制场次时归属随副本更新', () => {
  const { store } = makeStore();
  const sceneA = store.getActiveScene().id;
  store.startRecording();
  const event = store.recordEvent('La', 1000);
  store.stopRecording();
  assert.equal(event.sceneId, sceneA);
  assert.equal(event.source, 'live');
  assert.equal(event.note, 'La');

  const sceneC = store.duplicateScene(sceneA);
  const copied = store.getScene(sceneC)!.recording[0];
  assert.equal(copied.sceneId, sceneC);
  assert.equal(copied.source, 'duplicate');
  assert.notEqual(copied.id, event.id);
});

test('回放只回放当前场次，切换场次安全中断且不串入旧事件', () => {
  const { store, driver } = makeStore();
  const sceneA = store.getActiveScene().id;
  store.startRecording();
  store.recordEvent('Do', 100);
  store.recordEvent('Sol', 200);
  store.stopRecording();

  const sceneB = store.createScene('第二场');
  store.switchScene(sceneB);
  store.startRecording();
  store.recordEvent('Mi', 150);
  store.stopRecording();

  store.switchScene(sceneA);
  store.playScene(sceneA);
  assert.equal(store.getSnapshot().isPlaying, true);
  driver.advance(150);
  assert.deepEqual(driver.played, ['Do']);

  store.switchScene(sceneB);
  assert.equal(store.getSnapshot().isPlaying, false);
  driver.advance(60_000);
  assert.deepEqual(driver.played, ['Do'], 'A 场被中断后 Sol 不应再播放');

  store.playScene(sceneB);
  driver.advance(60_000);
  assert.deepEqual(driver.played, ['Do', 'Mi'], '只回放 B 场自己的序列');
  assert.equal(store.getSnapshot().isPlaying, false);
});

test('校验：越界/悬空挂载/超时事件分别定位到场次与对象', () => {
  const { store } = makeStore();
  const sceneA = store.getActiveScene().id;
  const sceneB = store.createScene('第二场');

  store.switchScene(sceneB);
  store.movePuppet(GENERAL, STAGE_WIDTH, STAGE_HEIGHT - PUPPET_HEIGHT + 10);
  store.setPuppetOnStage(GENERAL, true);
  store.startRecording();
  store.recordEvent('Do', 100);
  store.stopRecording();
  store.setSceneDuration(50);

  const sceneBProp = store.getActiveScene().props.find((pr) => pr.id === SWORD)!;
  sceneBProp.attachedTo = 'puppet-ghost';
  sceneBProp.attachmentPoint = 'leftHand';
  store.markSceneDirty();

  const reports = store.validateAll();
  const reportB = reports.find((r) => r.sceneId === sceneB)!;
  const kinds = reportB.issues.map((i) => i.kind).sort();
  assert.ok(kinds.includes('puppet-out-of-stage'));
  assert.ok(kinds.includes('mount-missing-puppet'));
  assert.ok(kinds.includes('event-out-of-duration'));

  const missingMount = reportB.issues.find((i) => i.kind === 'mount-missing-puppet')!;
  assert.equal(missingMount.sceneId, sceneB);
  const refTypes = missingMount.refs.map((ref) => ref.objectType);
  assert.ok(refTypes.includes('prop'));
  assert.ok(refTypes.includes('puppet'));
  assert.ok(missingMount.refs.some((ref) => ref.objectId === 'puppet-ghost'));

  const outOfStage = reportB.issues.find((i) => i.kind === 'puppet-out-of-stage')!;
  assert.equal(outOfStage.refs[0].objectId, GENERAL);
  assert.match(outOfStage.refs[0].detail, new RegExp(String(STAGE_WIDTH)));

  const reportA = reports.find((r) => r.sceneId === sceneA)!;
  assert.deepEqual(reportA.issues, []);
});

test('校验：双挂载冲突保留双方依据，修正后增量重算与整体重算一致', () => {
  const { store } = makeStore();
  const sceneA = store.getActiveScene().id;
  store.attachProp(SWORD, GENERAL, 'rightHand');
  store.movePuppet(GENERAL, 10, 10);

  store.markSceneDirty();
  let reports = store.revalidateDirty();
  assert.deepEqual(reports[0].issues, []);

  const scene = store.getScene(sceneA)!;
  const ledgerSword = scene.props.find((pr) => pr.id === SWORD)!;
  scene.puppets.find((p) => p.id === HEROINE)!.props.push({
    ...ledgerSword,
    attachmentPoint: 'leftHand',
  });
  store.markSceneDirty();
  reports = store.revalidateDirty();

  const conflict = reports[0].issues.find((i) => i.kind === 'prop-double-mount')!;
  assert.ok(conflict, '必须报出双挂载冲突而非静默择一');
  assert.ok(conflict.refs.some((ref) => ref.objectType === 'prop' && ref.objectId === SWORD));
  assert.ok(conflict.refs.some((ref) => ref.objectType === 'puppet' && ref.objectId === GENERAL));
  assert.ok(conflict.refs.some((ref) => ref.objectType === 'puppet' && ref.objectId === HEROINE));
  assert.ok(conflict.refs.some((ref) => /rightHand/.test(ref.detail)));
  assert.ok(conflict.refs.some((ref) => /leftHand/.test(ref.detail)));
  assert.deepEqual(store.validateAll(), reports);

  const heroine = scene.puppets.find((p) => p.id === HEROINE)!;
  heroine.props = heroine.props.filter((held) => held.id !== SWORD);
  store.markSceneDirty();
  const incremental = store.revalidateDirty();
  const full = store.validateAll();
  assert.deepEqual(incremental, full);
  assert.deepEqual(incremental.find((r) => r.sceneId === sceneA)!.issues, []);
});

test('挂载约束：占用点与携带上限拒绝，重复挂载保持账本一致', () => {
  const { store } = makeStore();
  store.attachProp(SWORD, GENERAL, 'rightHand');
  assert.throws(() => store.attachProp('prop-fan', GENERAL, 'rightHand'));
  store.attachProp('prop-fan', GENERAL, 'leftHand');
  assert.throws(() => store.attachProp('prop-drum', GENERAL, 'back'));

  store.attachProp(SWORD, HEROINE, 'leftHand');
  const scene = store.getActiveScene();
  assert.equal(scene.props.find((pr) => pr.id === SWORD)!.attachedTo, HEROINE);
  assert.equal(scene.puppets.find((p) => p.id === GENERAL)!.props.length, 1);
  assert.equal(scene.puppets.find((p) => p.id === HEROINE)!.props[0].id, SWORD);
});
