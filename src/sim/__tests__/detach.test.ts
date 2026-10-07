import { describe, expect, it } from 'vitest';
import { canonicalSlots, localOffset } from '../formations';
import { simulateFleet } from '../fleetSim';
import type { SimEvent } from '../types';
import { makeFleet } from './helpers';

describe('僚舰脱离补位', () => {
  const spec = makeFleet({ wingmen: 4 });
  const [flag, w1, w2, w3, w4] = spec.roster;

  it('脱离事件被记录，脱离舰船退出编队并停船', () => {
    const events: SimEvent[] = [
      { time: 6, type: 'detach', fleetId: spec.id, shipId: w2, cause: 'damage' },
    ];
    const sim = simulateFleet(spec, [], events, 12);
    expect(sim.getRoster()).toEqual([flag, w1, w3, w4]);
    expect(sim.getFlagshipId()).toBe(flag);
    const gone = sim.stateAt(12).ships.find((s) => s.id === w2)!;
    expect(gone.active).toBe(false);
    expect(gone.fleetId).toBeNull();
    expect(gone.speed).toBeCloseTo(0, 9);
    const log = sim.getEventLog().map((e) => e.type);
    expect(log).toContain('detach');
    expect(log).toContain('reslot');
  });

  it('剩余舰船按当前阵型规则自动补位，最终收敛到标准槽位', () => {
    const events: SimEvent[] = [
      { time: 6, type: 'detach', fleetId: spec.id, shipId: w2, cause: 'damage' },
    ];
    const sim = simulateFleet(spec, [], events, 20);
    // 补位快照：剩余 4 名成员（旗舰 + 3 僚舰）
    const reslot = sim.getSnapshots().find((s) => s.reason === 'reslot')!;
    expect(reslot.time).toBeCloseTo(6, 6);
    expect(reslot.flagshipId).toBe(flag);
    expect(reslot.members.map((m) => m.shipId)).toEqual([flag, w1, w3, w4]);
    // 收敛后：3 僚舰相对旗舰的本地偏移各自落在雁行阵 3 个标准槽位上
    const at20 = sim.stateAt(20);
    const flagState = at20.ships.find((s) => s.id === flag)!;
    const slots = canonicalSlots('yanxing', 3);
    const used = new Set<number>();
    for (const id of [w1, w3, w4]) {
      const s = at20.ships.find((x) => x.id === id)!;
      const off = localOffset(s.pos, flagState.pos, flagState.heading);
      const idx = slots.findIndex(
        (slot, i) => !used.has(i) && Math.hypot(slot.x - off.x, slot.y - off.y) < 1e-3,
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      used.add(idx);
    }
    expect(used.size).toBe(3);
  });

  it('脱离前的队形快照保留，可回看脱离瞬间几何', () => {
    const events: SimEvent[] = [
      { time: 6, type: 'detach', fleetId: spec.id, shipId: w2, cause: 'damage' },
    ];
    const sim = simulateFleet(spec, [], events, 12);
    const detachSnap = sim.getSnapshots().find((s) => s.reason === 'detach')!;
    expect(detachSnap.members).toHaveLength(5);
    expect(detachSnap.members.map((m) => m.shipId)).toContain(w2);
  });
});
