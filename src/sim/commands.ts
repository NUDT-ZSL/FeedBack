import type { CommandKind, EffectiveCommand, FleetCommand } from './types';

/**
 * 冲突分组：同组内的指令互相覆盖未执行部分。
 * - turn 与 turn 冲突（转向目标被替换）
 * - speed 与 speed 冲突（目标航速被替换）
 * - formation 与 disperse 冲突（队形几何被替换）
 */
const CONFLICT_GROUPS: Record<CommandKind, CommandKind[]> = {
  turn: ['turn'],
  speed: ['speed'],
  formation: ['formation', 'disperse'],
  disperse: ['formation', 'disperse'],
};

export const conflictsWith = (a: CommandKind, b: CommandKind): boolean =>
  CONFLICT_GROUPS[a].includes(b);

/**
 * 按下达时刻排序后做冲突消解：同组后到的指令把先到指令的
 * 有效窗口截断到自己的下达时刻（已执行部分保留在历史中）。
 * 返回的有效指令列表即“指令链”，原始指令不被删除。
 */
export function resolveCommands(commands: FleetCommand[]): EffectiveCommand[] {
  const sorted = [...commands].sort((a, b) =>
    a.issuedAt !== b.issuedAt
      ? a.issuedAt - b.issuedAt
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  const effective: EffectiveCommand[] = sorted.map((c) => ({
    ...c,
    start: c.issuedAt,
    end: c.issuedAt + Math.max(0, c.duration),
    status: 'executed',
  }));
  for (let i = 0; i < effective.length; i += 1) {
    for (let j = i + 1; j < effective.length; j += 1) {
      const later = effective[j];
      if (!conflictsWith(later.kind, effective[i].kind)) continue;
      if (later.start >= effective[i].end) continue;
      effective[i].end = later.start;
      effective[i].overriddenBy = later.id;
      effective[i].status =
        effective[i].end <= effective[i].start ? 'superseded' : 'truncated';
    }
  }
  return effective;
}

/** 汇总所有时间片边界：指令起止 + 事件时刻 + 起止时间。 */
export function sliceBoundaries(
  commands: EffectiveCommand[],
  eventTimes: number[],
  from: number,
  until: number,
): number[] {
  const set = new Set<number>([from, until]);
  for (const c of commands) {
    if (c.end > from && c.start < until) {
      set.add(Math.max(from, c.start));
      set.add(Math.min(until, c.end));
    }
  }
  for (const t of eventTimes) {
    if (t > from && t < until) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
}

/** 某时刻（片内）处于激活窗口的指令。 */
export function activeCommands(
  commands: EffectiveCommand[],
  t: number,
): EffectiveCommand[] {
  return commands.filter((c) => t >= c.start && t < c.end);
}
