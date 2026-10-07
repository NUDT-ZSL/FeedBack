import { describe, expect, it } from 'vitest';
import { ShowStore } from '../src/state/showStore';
import { PlaybackController } from '../src/state/playback';
import { makeFakeClock, makeSink } from './clock';
import { MAX_RECORDING_MS } from '../src/state/constants';

function setup() {
  const clock = makeFakeClock(1000);
  let n = 0;
  const idGen = (p: string) => `${p}-${++n}`;
  const playback = new PlaybackController(clock);
  const store = new ShowStore(idGen, clock.now, playback);
  return { clock, store };
}

describe('多场次：切换 / 复制 / 删除', () => {
  it('各场次独立保存皮影位姿与关节姿态，切换完整还原、不留残像', () => {
    const { store } = setup();
    const a = store.activeShow;
    store.movePuppet('puppet-scholar', 120, 200, true);
    store.toggleJoint('puppet-scholar', 'rightArm');

    const b = store.createShow('第二场');
    expect(store.activeId).toBe(b.id);
    store.movePuppet('puppet-general', 300, 300, true);
    // 第二场里书生必须是全新状态，不能残留第一场的位姿
    const scholarB = b.puppets.find((p) => p.id === 'puppet-scholar')!;
    expect(scholarB.isOnStage).toBe(false);
    expect(scholarB.position).toEqual({ x: 0, y: 0 });
    expect(scholarB.joints.rightArm.angle).toBe(0);

    const switchedA = store.switchShow(a.id);
    const scholarA = switchedA.puppets.find((p) => p.id === 'puppet-scholar')!;
    expect(scholarA.isOnStage).toBe(true);
    expect(scholarA.position).toEqual({ x: 120, y: 200 });
    expect(scholarA.joints.rightArm.angle).toBe(-90);
    expect(scholarA.joints.head.rotation).toBe(5);
    const generalA = switchedA.puppets.find((p) => p.id === 'puppet-general')!;
    expect(generalA.isOnStage).toBe(false);

    const switchedB = store.switchShow(b.id);
    expect(switchedB.puppets.find((p) => p.id === 'puppet-general')!.position).toEqual({
      x: 300,
      y: 300,
    });
  });

  it('复制场次作为新场次起点，录音事件重新归属并标记为 duplicated', () => {
    const { store, clock } = setup();
    const a = store.activeShow;
    store.movePuppet('puppet-clown', 10, 20, true);
    store.attachProp('prop-fan', 'puppet-clown', 'leftHand');
    store.startRecording();
    clock.advance(100);
    store.recordNote('Do');
    clock.advance(200);
    store.recordNote('Mi');
    store.stopRecording();
    expect(a.duration).toBe(300);

    const copy = store.duplicateShow(a.id);
    expect(copy.id).not.toBe(a.id);
    expect(copy.puppets.find((p) => p.id === 'puppet-clown')!.isOnStage).toBe(true);
    expect(copy.props.find((p) => p.id === 'prop-fan')!.attachedTo).toBe('puppet-clown');
    expect(copy.recording.events).toHaveLength(2);
    expect(copy.recording.events.every((e) => e.showId === copy.id)).toBe(true);
    expect(copy.recording.events.map((e) => e.source)).toEqual(['duplicated', 'duplicated']);
    expect(copy.recording.events.map((e) => e.timestamp)).toEqual([100, 300]);
    // 复制后再修改副本，不影响原场次
    store.detachProp('prop-fan');
    expect(a.props.find((p) => p.id === 'prop-fan')!.attachedTo).toBe('puppet-clown');
  });

  it('删除场次后其余场次原样保留；删空时自动补一个新场次', () => {
    const { store } = setup();
    const a = store.activeShow;
    const b = store.createShow('第二场');
    const c = store.createShow('第三场');
    store.attachProp('prop-sword', 'puppet-general', 'rightHand');

    store.deleteShow(b.id);
    expect(store.getShow(b.id)).toBeUndefined();
    expect(store.activeId).toBe(c.id);
    expect(a.props.find((p) => p.id === 'prop-sword')!.attachedTo).toBeNull();
    expect(c.props.find((p) => p.id === 'prop-sword')!.attachedTo).toBe('puppet-general');

    store.deleteShow(c.id);
    store.deleteShow(a.id);
    expect(store.listShows()).toHaveLength(1);
    expect(store.activeShow.puppets).toHaveLength(4);
  });
});

describe('道具账本跟随场次', () => {
  it('同一道具在不同场次可以有不同归属，账本与影人携带列表一致', () => {
    const { store } = setup();
    const a = store.activeShow;
    const r1 = store.attachProp('prop-sword', 'puppet-general', 'rightHand');
    expect(r1).toEqual({ ok: true });
    expect(a.props.find((p) => p.id === 'prop-sword')).toMatchObject({
      attachedTo: 'puppet-general',
      attachmentPoint: 'rightHand',
    });
    expect(a.puppets.find((p) => p.id === 'puppet-general')!.props.map((p) => p.id)).toContain(
      'prop-sword',
    );

    const b = store.createShow('第二场');
    store.attachProp('prop-sword', 'puppet-scholar', 'back');
    expect(b.props.find((p) => p.id === 'prop-sword')).toMatchObject({
      attachedTo: 'puppet-scholar',
      attachmentPoint: 'back',
    });

    // 切回第一场，长剑仍在武将右手
    expect(store.switchShow(a.id).props.find((p) => p.id === 'prop-sword')).toMatchObject({
      attachedTo: 'puppet-general',
      attachmentPoint: 'rightHand',
    });
    // 第二场归属不受影响
    expect(b.props.find((p) => p.id === 'prop-sword')!.attachedTo).toBe('puppet-scholar');
  });

  it('同一影人最多携带 2 个道具；换挂时从旧主人处摘除', () => {
    const { store } = setup();
    expect(store.attachProp('prop-sword', 'puppet-general', 'rightHand').ok).toBe(true);
    expect(store.attachProp('prop-drum', 'puppet-general', 'back').ok).toBe(true);
    const blocked = store.attachProp('prop-wineCup', 'puppet-general', 'leftHand');
    expect(blocked.ok).toBe(false);
    expect(store.activeShow.props.find((p) => p.id === 'prop-wineCup')!.attachedTo).toBeNull();

    // 挂到已有 2 件的第三件道具改挂别处：从武将处移走长剑，落到书生背上
    store.attachProp('prop-sword', 'puppet-scholar', 'back');
    const general = store.activeShow.puppets.find((p) => p.id === 'puppet-general')!;
    expect(general.props.map((p) => p.id)).toEqual(['prop-drum']);
    expect(store.attachProp('prop-wineCup', 'puppet-general', 'leftHand').ok).toBe(true);
  });

  it('摘除道具只影响当前场次', () => {
    const { store } = setup();
    const a = store.activeShow;
    store.attachProp('prop-fan', 'puppet-heroine', 'leftHand');
    const b = store.createShow('第二场');
    store.attachProp('prop-fan', 'puppet-clown', 'rightHand');
    store.detachProp('prop-fan');
    expect(b.props.find((p) => p.id === 'prop-fan')!.attachedTo).toBeNull();
    expect(a.props.find((p) => p.id === 'prop-fan')!.attachedTo).toBe('puppet-heroine');
  });
});

describe('锣鼓录音：归属、隔离与回放中断', () => {
  it('录音事件带场次归属，不同场次序列互不混入', () => {
    const { store, clock } = setup();
    const a = store.activeShow;
    store.startRecording();
    clock.advance(50);
    store.recordNote('Do');
    clock.advance(50);
    store.recordNote('Re');
    store.stopRecording();
    expect(a.recording.events.map((e) => e.note)).toEqual(['Do', 'Re']);
    expect(a.recording.events.every((e) => e.showId === a.id)).toBe(true);
    expect(a.recording.events.every((e) => e.source === 'recorded')).toBe(true);

    const b = store.createShow('第二场');
    store.startRecording();
    clock.advance(70);
    store.recordNote('La');
    store.stopRecording();
    expect(b.recording.events.map((e) => e.note)).toEqual(['La']);
    expect(a.recording.events).toHaveLength(2);
  });

  it('回放只播放当前场次事件', () => {
    const { store, clock } = setup();
    store.startRecording();
    clock.advance(100);
    store.recordNote('Do');
    clock.advance(100);
    store.recordNote('Sol');
    store.stopRecording();

    const b = store.createShow('第二场');
    store.startRecording();
    clock.advance(120);
    store.recordNote('Mi');
    store.stopRecording();

    store.switchShow(store.allShows()[0].id);
    const sink = makeSink(clock.now);
    store.playActiveShow(sink);
    clock.advance(500);
    expect(sink.notes.map((n) => n.note)).toEqual(['Do', 'Sol']);
    expect(sink.dances).toContain('jump');
    expect(sink.dances).toContain('bow');
  });

  it('回放中切换场次会安全中断，旧场次定时器不会混入新场次', () => {
    const { store, clock } = setup();
    store.startRecording();
    clock.advance(100);
    store.recordNote('Do');
    clock.advance(400);
    store.recordNote('Re'); // 500ms
    store.stopRecording();

    const b = store.createShow('第二场');
    store.startRecording();
    clock.advance(100);
    store.recordNote('Si');
    store.stopRecording();

    const a = store.switchShow(store.allShows()[0].id);
    const sink = makeSink(clock.now);
    store.playActiveShow(sink);
    clock.advance(150);
    expect(sink.notes.map((n) => n.note)).toEqual(['Do']);

    store.switchShow(b.id);
    const sinkB = makeSink(clock.now);
    store.playActiveShow(sinkB);
    clock.advance(400);
    // 第一场剩余的 Re 不能在第二场回放期间冒出来
    expect(sink.notes.map((n) => n.note)).toEqual(['Do']);
    expect(sinkB.notes.map((n) => n.note)).toEqual(['Si']);
    expect(store.playback.playingShowId).toBeNull();
    expect(a.recording.events).toHaveLength(2);
  });

  it('超过 30 秒的事件不被录制，场次时长封顶', () => {
    const { store, clock } = setup();
    store.startRecording();
    clock.advance(MAX_RECORDING_MS + 1);
    store.recordNote('Do');
    expect(store.activeShow.recording.events).toHaveLength(0);
    clock.advance(1000);
    store.stopRecording();
    expect(store.activeShow.duration).toBe(MAX_RECORDING_MS);
  });
});
