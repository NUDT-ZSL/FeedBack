import { describe, expect, it } from 'vitest';
import { ShowStore } from '../src/state/showStore';
import {
  ValidationEngine,
  validateShow,
  validateShows,
} from '../src/state/validation';
import { makeFakeClock } from './clock';
import { PUPPET_HEIGHT, PUPPET_WIDTH, STAGE_WIDTH } from '../src/state/constants';
import type { ShowState } from '../src/types';

function setup() {
  const clock = makeFakeClock();
  let n = 0;
  const idGen = (p: string) => `${p}-${++n}`;
  const store = new ShowStore(idGen, clock.now);
  return { clock, store };
}

describe('整体校验：定位到具体场次与对象', () => {
  it('干净场次无问题', () => {
    const { store } = setup();
    store.movePuppet('puppet-scholar', 100, 100, true);
    store.attachProp('prop-sword', 'puppet-general', 'rightHand');
    expect(validateShow(store.activeShow)).toEqual([]);
  });

  it('皮影超出舞台范围报错并携带坐标依据', () => {
    const { store } = setup();
    store.movePuppet('puppet-scholar', STAGE_WIDTH - PUPPET_WIDTH + 10, 400, true);
    const issues = validateShow(store.activeShow);
    const issue = issues.find((i) => i.type === 'puppet-out-of-stage');
    expect(issue).toBeTruthy();
    expect(issue!.showId).toBe(store.activeId);
    expect(issue!.objectId).toBe('puppet-scholar');
    expect(issue!.evidence[0].detail).toContain(String(STAGE_WIDTH));
  });

  it('挂载点指向不存在的皮影报错', () => {
    const { store } = setup();
    const prop = store.activeShow.props.find((p) => p.id === 'prop-fan')!;
    prop.attachedTo = 'puppet-ghost';
    prop.attachmentPoint = 'back';
    const issue = validateShow(store.activeShow).find(
      (i) => i.type === 'attachment-target-missing',
    );
    expect(issue!.objectId).toBe('prop-fan');
    expect(issue!.message).toContain('puppet-ghost');
  });

  it('同一道具多处挂载的冲突保留双方依据，不静默择一', () => {
    const { store } = setup();
    const show = store.activeShow;
    const sword = show.props.find((p) => p.id === 'prop-sword')!;
    sword.attachedTo = 'puppet-general';
    sword.attachmentPoint = 'rightHand';
    const general = show.puppets.find((p) => p.id === 'puppet-general')!;
    const scholar = show.puppets.find((p) => p.id === 'puppet-scholar')!;
    general.props.push(sword);
    // 影人携带列表侧的第二处主张：长剑被书生背在背上
    scholar.props.push({ ...sword, attachmentPoint: 'back' });

    const issue = validateShow(show).find((i) => i.type === 'mount-conflict');
    expect(issue).toBeTruthy();
    expect(issue!.objectId).toBe('prop-sword');
    expect(issue!.evidence).toHaveLength(2);
    expect(issue!.evidence.map((e) => e.objectId).sort()).toEqual([
      'puppet-general',
      'puppet-scholar',
    ]);
    expect(issue!.evidence.map((e) => e.detail).join(' ')).toContain('rightHand');
    expect(issue!.evidence.map((e) => e.detail).join(' ')).toContain('back');
  });

  it('录音事件时刻超出场次时长、归属错误均报错', () => {
    const { store, clock } = setup();
    store.startRecording();
    clock.advance(200);
    store.recordNote('Do');
    store.stopRecording();

    const show = store.activeShow;
    const ev = show.recording.events[0];
    ev.timestamp = show.duration + 50;
    expect(
      validateShow(show).find((i) => i.type === 'recording-event-out-of-duration'),
    ).toBeTruthy();
    ev.timestamp = 200;

    const foreign: ShowState['recording']['events'][number] = {
      ...ev,
      id: 'event-x',
      showId: 'other-show',
    };
    show.recording.events.push(foreign);
    const issues = validateShow(show);
    expect(issues.find((i) => i.type === 'foreign-recording-event')!.objectId).toBe(
      'event-x',
    );
  });

  it('影人携带超过 2 件道具给出警告', () => {
    const { store } = setup();
    const general = store.activeShow.puppets.find((p) => p.id === 'puppet-general')!;
    store.attachProp('prop-sword', 'puppet-general', 'rightHand');
    store.attachProp('prop-drum', 'puppet-general', 'back');
    const wine = store.activeShow.props.find((p) => p.id === 'prop-wineCup')!;
    general.props.push(wine); // 手工破坏上限
    const issue = validateShow(store.activeShow).find(
      (i) => i.type === 'puppet-over-capacity',
    );
    expect(issue!.severity).toBe('warning');
    expect(issue!.evidence).toHaveLength(3);
  });

  it('问题结果能区分具体场次', () => {
    const { store } = setup();
    const a = store.activeShow;
    const b = store.createShow('第二场');
    store.movePuppet('puppet-clown', -50, -50, true); // 第二场出错
    const result = validateShows(store.allShows());
    expect(result.get(a.id)).toEqual([]);
    expect(result.get(b.id)![0].showId).toBe(b.id);
    expect(PUPPET_HEIGHT).toBeGreaterThan(0);
  });
});

describe('增量重算与整体重算一致', () => {
  it('只重算受影响场次，未受影响场次复用缓存，合并结果等于整体重算', () => {
    const { store } = setup();
    const a = store.activeShow;
    const b = store.createShow('第二场');
    const c = store.createShow('第三场');
    store.switchShow(a.id);
    store.movePuppet('puppet-scholar', 10, 10, true);
    store.switchShow(b.id);
    store.movePuppet('puppet-clown', 9999, 9999, true); // B 越界
    store.switchShow(c.id);
    store.attachProp('prop-letter', 'puppet-heroine', 'leftHand');

    const engine = new ValidationEngine();
    engine.validate(store.allShows());

    // 修复 B
    store.switchShow(b.id);
    store.movePuppet('puppet-clown', 50, 50, true);

    const incremental = engine.validate(store.allShows(), { onlyShowIds: [b.id] });
    const full = validateShows(store.allShows());
    for (const id of [a.id, b.id, c.id]) {
      expect(incremental.get(id)).toEqual(full.get(id));
    }
    expect(incremental.get(b.id)).toEqual([]);
    expect(incremental.get(a.id)).toEqual([]);
    expect(incremental.get(c.id)).toEqual([]);
  });

  it('再次制造问题后增量结果仍然与整体重算一致', () => {
    const { store, clock } = setup();
    const a = store.activeShow;
    const b = store.createShow('第二场');
    const engine = new ValidationEngine();
    engine.validate(store.allShows());

    store.switchShow(a.id);
    store.startRecording();
    clock.advance(100);
    store.recordNote('Do');
    store.stopRecording();
    const ev = a.recording.events[0];
    ev.timestamp = a.duration + 1; // 手工破坏

    const incremental = engine.validate(store.allShows(), { onlyShowIds: [a.id] });
    const full = validateShows(store.allShows());
    expect(incremental.get(a.id)).toEqual(full.get(a.id));
    expect(incremental.get(b.id)).toEqual(full.get(b.id));
    expect(incremental.get(a.id)!.map((i) => i.type)).toContain(
      'recording-event-out-of-duration',
    );
  });
});
