import { describe, expect, it } from 'vitest';
import { resolveCommands } from '../commands';
import { simulateFleet } from '../fleetSim';
import type { FleetCommand } from '../types';
import { makeFleet } from './helpers';

const turn = (id: string, issuedAt: number, duration: number, delta: number): FleetCommand => ({
  id, fleetId: 'fleet-1', kind: 'turn', issuedAt, duration, headingDelta: delta,
});

describe('指令冲突覆盖', () => {
  it('后者截断前者的未执行部分，已执行部分保留', () => {
    const chain = resolveCommands([
      turn('A', 0, 10, 1.0),
      turn('B', 4, 2, -0.5),
    ]);
    const a = chain.find((c) => c.id === 'A')!;
    const b = chain.find((c) => c.id === 'B')!;
    expect(a.status).toBe('truncated');
    expect(a.start).toBe(0);
    expect(a.end).toBe(4);
    expect(a.overriddenBy).toBe('B');
    expect(b.status).toBe('executed');
    expect(b.end).toBe(6);
  });

  it('推演结果 = 前者已执行部分 + 后者完整执行', () => {
    const spec = makeFleet();
    const sim = simulateFleet(spec, [turn('A', 0, 10, 1.0), turn('B', 4, 2, -0.5)], [], 12);
    const at4 = sim.stateAt(4).ships.find((s) => s.id === spec.flagshipId)!;
    const at12 = sim.stateAt(12).ships.find((s) => s.id === spec.flagshipId)!;
    // A 执行了 4s：0.1 rad/s * 4 = 0.4
    expect(at4.heading).toBeCloseTo(0.4, 6);
    // B 完整执行：0.4 - 0.5 = -0.1，之后保持
    expect(at12.heading).toBeCloseTo(-0.1, 6);
  });

  it('同一时刻下达的同组指令，先到者被完全覆盖（superseded）', () => {
    const chain = resolveCommands([turn('A', 2, 5, 1), turn('B', 2, 3, -1)]);
    expect(chain.find((c) => c.id === 'A')!.status).toBe('superseded');
    expect(chain.find((c) => c.id === 'B')!.status).toBe('executed');
  });

  it('变阵与散开同属一组互相覆盖，转向/加速不互相干扰', () => {
    const cmds: FleetCommand[] = [
      { id: 'F1', fleetId: 'f', kind: 'formation', issuedAt: 0, duration: 10, formation: 'yulin' },
      { id: 'D1', fleetId: 'f', kind: 'disperse', issuedAt: 3, duration: 4 },
      { id: 'T1', fleetId: 'f', kind: 'turn', issuedAt: 3, duration: 4, headingDelta: 0.5 },
      { id: 'S1', fleetId: 'f', kind: 'speed', issuedAt: 3, duration: 4, targetSpeed: 3 },
    ];
    const chain = resolveCommands(cmds);
    expect(chain.find((c) => c.id === 'F1')!.status).toBe('truncated');
    expect(chain.find((c) => c.id === 'F1')!.end).toBe(3);
    expect(chain.find((c) => c.id === 'T1')!.status).toBe('executed');
    expect(chain.find((c) => c.id === 'S1')!.status).toBe('executed');
  });

  it('被覆盖指令的历史与快照不丢失，可回看', () => {
    const spec = makeFleet();
    const cmds: FleetCommand[] = [
      { id: 'F1', fleetId: 'fleet-1', kind: 'formation', issuedAt: 1, duration: 10, formation: 'yulin' },
      { id: 'F2', fleetId: 'fleet-1', kind: 'formation', issuedAt: 3, duration: 4, formation: 'yanyue' },
    ];
    const sim = simulateFleet(spec, cmds, [], 12);
    const chain = sim.getCommandChain();
    // 两条指令都保留在指令链历史中
    expect(chain.map((c) => c.id)).toEqual(['F1', 'F2']);
    expect(chain[0].status).toBe('truncated');
    // F1 变阵前/后快照都在（F1 被截断，after 快照带 truncated 标记）
    const f1Before = sim.getSnapshots().find((s) => s.commandId === 'F1' && s.reason === 'formation-before');
    const f1After = sim.getSnapshots().find((s) => s.commandId === 'F1' && s.reason === 'formation-after');
    expect(f1Before).toBeDefined();
    expect(f1After).toBeDefined();
    expect(f1After!.truncated).toBe(true);
    expect(f1After!.time).toBeCloseTo(3, 6);
    // F2 完整执行，after 快照在 t=7
    const f2After = sim.getSnapshots().find((s) => s.commandId === 'F2' && s.reason === 'formation-after');
    expect(f2After!.truncated).toBe(false);
    expect(f2After!.time).toBeCloseTo(7, 6);
  });
});
