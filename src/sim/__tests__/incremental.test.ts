import { describe, expect, it } from 'vitest';
import { FleetEngine } from '../engine';
import type { FleetCommand } from '../types';
import { makeFleet } from './helpers';

const fleetA = makeFleet({ id: 'A', wingmen: 4 });
const fleetB = makeFleet({ id: 'B', wingmen: 3, origin: { x: 0, y: 100 } });

function buildEngine(): FleetEngine {
  const engine = new FleetEngine(0.1);
  engine.addFleet(fleetA);
  engine.addFleet(fleetB);
  const cmds: FleetCommand[] = [
    { id: 'A-T1', fleetId: 'A', kind: 'turn', issuedAt: 0, duration: 12, headingDelta: 0.8 },
    { id: 'A-F1', fleetId: 'A', kind: 'formation', issuedAt: 3, duration: 5, formation: 'yulin' },
    { id: 'A-S1', fleetId: 'A', kind: 'speed', issuedAt: 2, duration: 4, targetSpeed: 3 },
    { id: 'B-T1', fleetId: 'B', kind: 'turn', issuedAt: 1, duration: 6, headingDelta: -0.4 },
  ];
  cmds.forEach((c) => engine.issueCommand(c));
  engine.advanceTo(10);
  // 中途事件：A 编队僚舰 w2 触礁脱离，随后旗舰移除（移交）
  engine.detachShip('A', 'A-w2', 6, 'reef');
  engine.detachShip('A', 'A-flag', 8, 'damage');
  engine.issueCommand({ id: 'A-T2', fleetId: 'A', kind: 'turn', issuedAt: 9, duration: 3, headingDelta: -0.3 });
  engine.advanceTo(20);
  return engine;
}

describe('增量重推', () => {
  it('局部重推结论与整体重推一致（位置 / 朝向 / 旗舰归属 / 快照）', () => {
    const engine = buildEngine();
    const full = engine.fullRecompute('A', 20);

    const inc = engine.stateAt(20).ships.filter((s) => s.id.startsWith('A-'));
    const ref = full.stateAt(20).ships;
    expect(inc.length).toBe(ref.length);
    for (const rs of ref) {
      const is = inc.find((s) => s.id === rs.id)!;
      expect(is.pos.x).toBeCloseTo(rs.pos.x, 9);
      expect(is.pos.y).toBeCloseTo(rs.pos.y, 9);
      expect(is.heading).toBeCloseTo(rs.heading, 9);
      expect(is.fleetId).toBe(rs.fleetId);
      expect(is.active).toBe(rs.active);
    }
    // 旗舰移交结论一致
    expect(engine.flagshipId('A')).toBe('A-w1');
    expect(full.getFlagshipId()).toBe('A-w1');
    // 快照序列一致（变阵前后 / 补位 / 移交依据）
    const incSnaps = engine.snapshots('A');
    const refSnaps = full.getSnapshots();
    expect(incSnaps.length).toBe(refSnaps.length);
    incSnaps.forEach((s, i) => {
      expect(s.reason).toBe(refSnaps[i].reason);
      expect(s.time).toBeCloseTo(refSnaps[i].time, 9);
      expect(s.flagshipId).toBe(refSnaps[i].flagshipId);
      expect(s.members.map((m) => m.shipId)).toEqual(
        refSnaps[i].members.map((m) => m.shipId),
      );
    });
    // 指令链一致
    expect(engine.commandChain('A').map((c) => [c.id, c.start, c.end, c.status])).toEqual(
      full.getCommandChain().map((c) => [c.id, c.start, c.end, c.status]),
    );
  });

  it('只重推受影响编队与受影响时间区间', () => {
    const engine = new FleetEngine(0.1);
    engine.addFleet(fleetA);
    engine.addFleet(fleetB);
    engine.issueCommand({ id: 'A-T1', fleetId: 'A', kind: 'turn', issuedAt: 0, duration: 12, headingDelta: 0.8 });
    engine.issueCommand({ id: 'B-T1', fleetId: 'B', kind: 'turn', issuedAt: 1, duration: 6, headingDelta: -0.4 });
    engine.advanceTo(10);
    const before = engine.stats();
    const aBefore = before.find((s) => s.fleetId === 'A')!.stepsIntegrated;
    const bBefore = before.find((s) => s.fleetId === 'B')!.stepsIntegrated;
    expect(aBefore).toBe(100);
    expect(bBefore).toBe(100);

    // A 在 t=6 有舰船脱离：仅 A 重推 [6,10]，B 完全不动
    engine.detachShip('A', 'A-w2', 6, 'reef');
    const after = engine.stats();
    const aAfter = after.find((s) => s.fleetId === 'A')!.stepsIntegrated;
    const bAfter = after.find((s) => s.fleetId === 'B')!.stepsIntegrated;
    expect(bAfter).toBe(bBefore);
    expect(aAfter - aBefore).toBe(40); // 仅 [6,10] 尾部
  });

  it('任意时刻可查询确定的位置 / 朝向 / 所属编队', () => {
    const engine = buildEngine();
    for (const t of [0, 3.3, 6, 8, 12.7, 20]) {
      const { ships } = engine.stateAt(t);
      expect(ships.length).toBe(9);
      for (const s of ships) {
        expect(Number.isFinite(s.pos.x)).toBe(true);
        expect(Number.isFinite(s.pos.y)).toBe(true);
        expect(Number.isFinite(s.heading)).toBe(true);
        if (s.active) expect(s.fleetId).not.toBeNull();
        else expect(s.fleetId).toBeNull();
      }
    }
    // 脱离的两艘船不再属于任何编队
    const at20 = engine.stateAt(20).ships;
    expect(at20.find((s) => s.id === 'A-w2')!.active).toBe(false);
    expect(at20.find((s) => s.id === 'A-flag')!.active).toBe(false);
    expect(engine.roster('A')).toEqual(['A-w1', 'A-w3', 'A-w4']);
  });
});
