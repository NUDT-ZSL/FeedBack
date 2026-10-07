import { describe, expect, it } from 'vitest';
import { localOffset } from '../formations';
import { simulateFleet } from '../fleetSim';
import type { FleetCommand } from '../types';
import { makeFleet } from './helpers';

describe('加速与散开指令', () => {
  const spec = makeFleet({ wingmen: 2, speed: 2 });
  const flag = spec.flagshipId;

  it('加速指令在时长内线性到达目标航速，被截断时停在中间值', () => {
    const cmds: FleetCommand[] = [
      { id: 'S1', fleetId: spec.id, kind: 'speed', issuedAt: 0, duration: 4, targetSpeed: 4 },
      { id: 'S2', fleetId: spec.id, kind: 'speed', issuedAt: 2, duration: 2, targetSpeed: 1 },
    ];
    const sim = simulateFleet(spec, cmds, [], 8);
    // S1 执行 2s（0.5/s）：2 + 1 = 3；随后 S2 两秒到 1
    expect(sim.stateAt(2).ships.find((s) => s.id === flag)!.speed).toBeCloseTo(3, 6);
    expect(sim.stateAt(4).ships.find((s) => s.id === flag)!.speed).toBeCloseTo(1, 6);
    const chain = sim.getCommandChain();
    expect(chain.find((c) => c.id === 'S1')!.status).toBe('truncated');
    expect(chain.find((c) => c.id === 'S2')!.status).toBe('executed');
  });

  it('散开指令保留相对阵型依据并按倍率放大，前后均可快照回看', () => {
    const cmds: FleetCommand[] = [
      { id: 'D1', fleetId: spec.id, kind: 'disperse', issuedAt: 2, duration: 4, disperseScale: 2 },
    ];
    const sim = simulateFleet(spec, cmds, [], 8);
    const at6 = sim.stateAt(6);
    const flagState = at6.ships.find((s) => s.id === flag)!;
    const before = sim.getSnapshots().find((s) => s.commandId === 'D1' && s.reason === 'disperse-before')!;
    const after = sim.getSnapshots().find((s) => s.commandId === 'D1' && s.reason === 'disperse-after')!;
    expect(before.time).toBeCloseTo(2, 6);
    expect(after.time).toBeCloseTo(6, 6);
    // 散开后各僚舰相对旗舰偏移 = 散开前依据的 2 倍
    after.members
      .filter((m) => m.shipId !== flag)
      .forEach((mAfter) => {
        const mBefore = before.members.find((m) => m.shipId === mAfter.shipId)!;
        expect(mAfter.offset.x).toBeCloseTo(mBefore.offset.x * 2, 6);
        expect(mAfter.offset.y).toBeCloseTo(mBefore.offset.y * 2, 6);
      });
    // 实际位置与快照一致（阵型依据可追溯）
    for (const id of spec.roster.filter((r) => r !== flag)) {
      const s = at6.ships.find((x) => x.id === id)!;
      const off = localOffset(s.pos, flagState.pos, flagState.heading);
      const snap = after.members.find((m) => m.shipId === id)!;
      expect(off.x).toBeCloseTo(snap.offset.x, 6);
      expect(off.y).toBeCloseTo(snap.offset.y, 6);
    }
  });

  it('同一参数重复推演结果完全一致（可离线重复执行）', () => {
    const cmds: FleetCommand[] = [
      { id: 'S1', fleetId: spec.id, kind: 'speed', issuedAt: 0, duration: 4, targetSpeed: 4 },
      { id: 'T1', fleetId: spec.id, kind: 'turn', issuedAt: 1, duration: 3, headingDelta: 0.5 },
    ];
    const a = simulateFleet(spec, cmds, [], 10);
    const b = simulateFleet(spec, cmds, [], 10);
    expect(b.stateAt(7.3).ships).toEqual(a.stateAt(7.3).ships);
  });
});
