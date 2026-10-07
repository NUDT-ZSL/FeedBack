import { describe, expect, it } from 'vitest';
import { simulateFleet } from '../fleetSim';
import type { FleetCommand, SimEvent } from '../types';
import { makeFleet } from './helpers';

describe('旗舰移交', () => {
  const spec = makeFleet({ wingmen: 3 });
  const [flag, w1, w2, w3] = spec.roster;

  it('旗舰被移除后按名册资历移交，并记录归属依据快照', () => {
    const events: SimEvent[] = [
      { time: 5, type: 'detach', fleetId: spec.id, shipId: flag, cause: 'reef' },
    ];
    const sim = simulateFleet(spec, [], events, 10);
    expect(sim.getFlagshipId()).toBe(w1);
    expect(sim.getRoster()).toEqual([w1, w2, w3]);
    const handover = sim.getSnapshots().find((s) => s.reason === 'flagship-handover');
    expect(handover).toBeDefined();
    expect(handover!.flagshipId).toBe(w1);
    expect(handover!.handover).toEqual({
      previousFlagshipId: flag,
      rule: 'seniority',
      cause: 'reef',
    });
    expect(handover!.members.map((m) => m.shipId)).toEqual([w1, w2, w3]);
  });

  it('移交瞬间位置连续、无跳变，阵型依据以新旗舰重算', () => {
    const events: SimEvent[] = [
      { time: 5, type: 'detach', fleetId: spec.id, shipId: flag, cause: 'damage' },
    ];
    const sim = simulateFleet(spec, [], events, 10);
    const before = sim.stateAt(4.9);
    const after = sim.stateAt(5);
    for (const id of [w1, w2, w3]) {
      const b = before.ships.find((s) => s.id === id)!;
      const a = after.ships.find((s) => s.id === id)!;
      // 一个步长内的位移有界（速度 <= maxSpeed*2），不存在瞬移
      const jump = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      expect(jump).toBeLessThan(1.0);
    }
    // 脱离的旗舰不再属于编队且停船
    const detached = after.ships.find((s) => s.id === flag)!;
    expect(detached.active).toBe(false);
    expect(detached.fleetId).toBeNull();
  });

  it('移交后指令链对新旗舰继续生效（重算而非失效）', () => {
    const cmds: FleetCommand[] = [
      { id: 'T1', fleetId: spec.id, kind: 'turn', issuedAt: 6, duration: 2, headingDelta: 0.6 },
    ];
    const events: SimEvent[] = [
      { time: 5, type: 'detach', fleetId: spec.id, shipId: flag, cause: 'reef' },
    ];
    const sim = simulateFleet(spec, cmds, events, 10);
    const newFlag = sim.stateAt(10).ships.find((s) => s.id === w1)!;
    expect(newFlag.heading).toBeCloseTo(0.6, 6);
    // 指令链仍然完整保留
    expect(sim.getCommandChain().map((c) => c.id)).toEqual(['T1']);
  });

  it('全员脱离后编队停摆，不会无旗舰继续执行编队指令', () => {
    const single = makeFleet({ wingmen: 0 });
    const onlyFlag = single.flagshipId;
    const cmds: FleetCommand[] = [
      { id: 'T1', fleetId: single.id, kind: 'turn', issuedAt: 6, duration: 2, headingDelta: 1.0 },
      { id: 'F1', fleetId: single.id, kind: 'formation', issuedAt: 6, duration: 2, formation: 'yulin' },
    ];
    const events: SimEvent[] = [
      { time: 5, type: 'detach', fleetId: single.id, shipId: onlyFlag, cause: 'reef' },
    ];
    const sim = simulateFleet(single, cmds, events, 10);
    const ship = sim.stateAt(10).ships.find((s) => s.id === onlyFlag)!;
    // 船已脱离且停船，转向指令不产生任何效果
    expect(ship.active).toBe(false);
    expect(ship.heading).toBeCloseTo(0, 9);
    // 停摆后不产生变阵快照
    expect(sim.getSnapshots().filter((s) => s.reason === 'formation-after')).toHaveLength(0);
  });
});
