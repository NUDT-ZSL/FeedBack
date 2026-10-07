import { describe, expect, it } from 'vitest';
import { canonicalSlots, localOffset } from '../formations';
import { simulateFleet } from '../fleetSim';
import type { FleetCommand } from '../types';
import { makeFleet } from './helpers';

const spec = makeFleet({ wingmen: 4 });
const flag = spec.flagshipId;

/** 转向 [0,10] 与变阵 [4,8] 部分重叠。 */
const cmds: FleetCommand[] = [
  { id: 'T', fleetId: spec.id, kind: 'turn', issuedAt: 0, duration: 10, headingDelta: Math.PI / 2 },
  { id: 'F', fleetId: spec.id, kind: 'formation', issuedAt: 4, duration: 4, formation: 'yulin' },
];

describe('转向与变阵时间片重叠', () => {
  const sim = simulateFleet(spec, cmds, [], 12);

  it('指令链保留两条指令的有效窗口', () => {
    const chain = sim.getCommandChain();
    expect(chain.find((c) => c.id === 'T')!.end).toBeCloseTo(10, 9);
    expect(chain.find((c) => c.id === 'F')!.end).toBeCloseTo(8, 9);
  });

  it('重叠边界处位置连续，无跳变', () => {
    // 逐帧检查 3.5 ~ 8.5 之间相邻采样位移有界
    // （变阵期间限速 maxSpeed*4 = 16，即单步位移 <= 1.6，不存在瞬移）
    for (let t = 3.5; t < 8.5; t += 0.1) {
      const a = sim.stateAt(t);
      const b = sim.stateAt(t + 0.1);
      for (const sa of a.ships) {
        const sb = b.ships.find((s) => s.id === sa.id)!;
        const step = Math.hypot(sb.pos.x - sa.pos.x, sb.pos.y - sa.pos.y);
        expect(step).toBeLessThan(16 * 0.1 + 1e-6);
      }
    }
  });

  it('重叠期转向不被重复计算：t=10 时总转角恰为指令值', () => {
    const at10 = sim.stateAt(10).ships.find((s) => s.id === flag)!;
    expect(at10.heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it('变阵窗口结束时僚舰精确到达新阵型槽位（相对当前旗舰航向）', () => {
    const at8 = sim.stateAt(8);
    const flagState = at8.ships.find((s) => s.id === flag)!;
    const slots = canonicalSlots('yulin', 4);
    const used = new Set<number>();
    for (const id of spec.roster.filter((r) => r !== flag)) {
      const s = at8.ships.find((x) => x.id === id)!;
      const off = localOffset(s.pos, flagState.pos, flagState.heading);
      const idx = slots.findIndex(
        (slot, i) => !used.has(i) && Math.hypot(slot.x - off.x, slot.y - off.y) < 1e-3,
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      used.add(idx);
    }
  });

  it('重叠期位移不是两段简单叠加：与纯转向参照系存在队形收敛差异', () => {
    // 参照：只有转向指令
    const ref = simulateFleet(spec, [cmds[0]], [], 12);
    const a = sim.stateAt(6).ships.find((s) => s.id === spec.roster[1])!;
    const b = ref.stateAt(6).ships.find((s) => s.id === spec.roster[1])!;
    const diff = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(diff).toBeGreaterThan(0.1);
    // 但两者都连续（差异是平滑累积而非跳变）
    expect(diff).toBeLessThan(30);
  });

  it('变阵前后快照可用于对照', () => {
    const before = sim.getSnapshots().find((s) => s.commandId === 'F' && s.reason === 'formation-before')!;
    const after = sim.getSnapshots().find((s) => s.commandId === 'F' && s.reason === 'formation-after')!;
    expect(before.time).toBeCloseTo(4, 6);
    expect(after.time).toBeCloseTo(8, 6);
    expect(before.formation).toBe('yanxing');
    expect(after.formation).toBe('yulin');
    expect(before.flagshipId).toBe(flag);
    expect(after.flagshipId).toBe(flag);
  });
});
