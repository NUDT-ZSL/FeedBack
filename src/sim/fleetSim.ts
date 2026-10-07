import { activeCommands, resolveCommands, sliceBoundaries } from './commands';
import { assignSlots, canonicalSlots, localOffset } from './formations';
import type { Vec2 } from './geometry';
import { add, headingOf, len, rotate, scale, sub } from './geometry';
import type {
  EffectiveCommand,
  EventRecord,
  FleetCommand,
  FleetSample,
  FleetSpec,
  FormationSnapshot,
  FormationType,
  ShipState,
  SimEvent,
  SnapshotReason,
} from './types';

const EPS = 1e-9;
/** 非变阵期间的保位增益（1/秒）。 */
const STATION_GAIN = 1.5;
/** 保位追位允许的最大航速倍率。 */
const CATCHUP_FACTOR = 2;
/** 变阵期间允许的最大航速倍率（保证收敛的同时位移有界、无跳变）。 */
const FORMATION_FACTOR = 4;

interface CommandRuntime {
  activated: boolean;
  startSpeed: number;
}

interface RuntimeState {
  ships: Map<string, ShipState>;
  roster: string[];
  flagshipId: string;
  formation: FormationType | 'disperse';
  basis: Map<string, Vec2>;
  cmdState: Map<string, CommandRuntime>;
  defunct: boolean;
}

interface Checkpoint {
  time: number;
  preEvent: boolean;
  state: RuntimeState;
  snapshotsLen: number;
  eventLogLen: number;
  samplesLen: number;
}

const cloneState = (s: RuntimeState): RuntimeState => ({
  ships: new Map([...s.ships].map(([k, v]) => [k, { ...v, pos: { ...v.pos } }])),
  roster: [...s.roster],
  flagshipId: s.flagshipId,
  formation: s.formation,
  basis: new Map([...s.basis].map(([k, v]) => [k, { ...v }])),
  cmdState: new Map([...s.cmdState].map(([k, v]) => [k, { ...v }])),
  defunct: s.defunct,
});

/**
 * 单编队推演器：按指令链与事件做确定性定步长推演。
 * 支持 truncateTo(t) 回滚到 t 时刻（含）之前的检查点，
 * 用于旗舰变更 / 僚舰脱离后的局部重推。
 */
export class FleetSimulation {
  readonly fleetId: string;
  readonly dt: number;
  /** 已执行的积分步数（用于验证局部重推范围）。 */
  stepsIntegrated = 0;

  private commands: FleetCommand[] = [];
  private events: SimEvent[] = [];
  private effective: EffectiveCommand[] = [];
  private nextEventIdx = 0;

  private state: RuntimeState;
  private time: number;
  private samples: FleetSample[] = [];
  private snapshots: FormationSnapshot[] = [];
  private eventLog: EventRecord[] = [];
  private checkpoints: Checkpoint[] = [];

  constructor(spec: FleetSpec, dt = 0.1, startTime = 0) {
    this.fleetId = spec.id;
    this.dt = dt;
    const ships = new Map<string, ShipState>();
    for (const s of spec.ships) {
      ships.set(s.id, {
        ...s,
        pos: { ...s.pos },
        fleetId: spec.id,
        active: true,
      });
    }
    const wingmen = spec.roster.filter((id) => id !== spec.flagshipId);
    const slots = canonicalSlots(spec.formation, wingmen.length);
    const basis = new Map<string, Vec2>();
    wingmen.forEach((id, i) => basis.set(id, slots[i]));
    this.state = {
      ships,
      roster: [...spec.roster],
      flagshipId: spec.flagshipId,
      formation: spec.formation,
      basis,
      cmdState: new Map(),
      defunct: false,
    };
    this.time = startTime;
    this.recordSample();
    this.pushCheckpoint(true);
  }

  setCommands(commands: FleetCommand[]): void {
    this.commands = commands.filter((c) => c.fleetId === this.fleetId);
    this.effective = resolveCommands(this.commands);
  }

  setEvents(events: SimEvent[]): void {
    this.events = events
      .filter((e) => e.fleetId === this.fleetId)
      .sort((a, b) => a.time - b.time);
  }

  get currentTime(): number {
    return this.time;
  }

  getSnapshots(): FormationSnapshot[] {
    return this.snapshots.map((s) => ({ ...s }));
  }

  getEventLog(): EventRecord[] {
    return [...this.eventLog];
  }

  getCommandChain(): EffectiveCommand[] {
    return this.effective.map((c) => ({ ...c }));
  }

  getFlagshipId(): string {
    return this.state.flagshipId;
  }

  getRoster(): string[] {
    return [...this.state.roster];
  }

  /** 回滚到 t 时刻：恢复 t（含）之前最近的“事件前”检查点。 */
  truncateTo(t: number): void {
    if (t >= this.time - EPS) return;
    let idx = -1;
    for (let i = this.checkpoints.length - 1; i >= 0; i -= 1) {
      const cp = this.checkpoints[i];
      if (cp.time < t - EPS || (Math.abs(cp.time - t) <= EPS && cp.preEvent)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) throw new Error(`no checkpoint at or before t=${t}`);
    const cp = this.checkpoints[idx];
    this.state = cloneState(cp.state);
    this.time = cp.time;
    this.snapshots.length = cp.snapshotsLen;
    this.eventLog.length = cp.eventLogLen;
    this.samples.length = cp.samplesLen;
    this.checkpoints.length = idx + 1;
    // preEvent 检查点：该时刻的事件尚未应用，需重新应用；
    // postEvent 检查点：该时刻（含）之前的事件已应用。
    this.nextEventIdx = cp.preEvent
      ? this.events.filter((e) => e.time < this.time - EPS).length
      : this.events.filter((e) => e.time <= this.time + EPS).length;
  }

  advanceTo(until: number): void {
    if (until <= this.time + EPS) {
      this.applyEventsAt(this.time);
      return;
    }
    const eventTimes = this.events.map((e) => e.time);
    const bounds = sliceBoundaries(this.effective, eventTimes, this.time, until);
    for (let i = 0; i < bounds.length - 1; i += 1) {
      this.applyEventsAt(bounds[i]);
      this.integrate(bounds[i], bounds[i + 1]);
    }
    this.applyEventsAt(until);
  }

  stateAt(t: number): FleetSample {
    let best = this.samples[0];
    for (const s of this.samples) {
      if (s.time <= t + EPS) best = s;
      else break;
    }
    return { time: best.time, ships: best.ships.map((s) => ({ ...s, pos: { ...s.pos } })) };
  }

  // ---- 内部实现 ----

  private pushCheckpoint(preEvent: boolean): void {
    this.checkpoints.push({
      time: this.time,
      preEvent,
      state: cloneState(this.state),
      snapshotsLen: this.snapshots.length,
      eventLogLen: this.eventLog.length,
      samplesLen: this.samples.length,
    });
  }

  private recordSample(): void {
    this.samples.push({
      time: this.time,
      ships: [...this.state.ships.values()].map((s) => ({ ...s, pos: { ...s.pos } })),
    });
  }

  private applyEventsAt(t: number): void {
    let applied = false;
    while (
      this.nextEventIdx < this.events.length &&
      this.events[this.nextEventIdx].time <= t + EPS
    ) {
      this.applyDetach(this.events[this.nextEventIdx]);
      this.nextEventIdx += 1;
      applied = true;
    }
    if (applied) {
      this.recordSample();
      this.pushCheckpoint(false);
    }
  }

  private applyDetach(event: SimEvent): void {
    const st = this.state;
    const ship = st.ships.get(event.shipId);
    if (!ship || ship.fleetId !== this.fleetId || !ship.active) return;

    this.captureSnapshot('detach');
    ship.active = false;
    ship.fleetId = null;
    ship.speed = 0;
    st.roster = st.roster.filter((id) => id !== event.shipId);
    st.basis.delete(event.shipId);
    this.eventLog.push({
      time: this.time,
      type: 'detach',
      fleetId: this.fleetId,
      shipId: event.shipId,
      detail: `${event.shipId} detached (${event.cause})`,
    });

    if (event.shipId === st.flagshipId) {
      if (st.roster.length === 0) {
        // 编队无剩余舰船：置为停摆，绝不出现“无旗舰仍执行编队指令”。
        st.defunct = true;
        st.basis.clear();
        return;
      }
      // 预设规则：按名册资历顺序移交旗舰。
      const prev = st.flagshipId;
      st.flagshipId = st.roster[0];
      const newFlag = st.ships.get(st.flagshipId)!;
      // 以新旗舰当前位置/朝向重算阵型依据，保证几何连续、无跳变。
      const basis = new Map<string, Vec2>();
      for (const id of st.roster) {
        if (id === st.flagshipId) continue;
        const s = st.ships.get(id)!;
        basis.set(id, localOffset(s.pos, newFlag.pos, newFlag.heading));
      }
      st.basis = basis;
      this.eventLog.push({
        time: this.time,
        type: 'flagship-handover',
        fleetId: this.fleetId,
        shipId: st.flagshipId,
        detail: `flagship ${prev} -> ${st.flagshipId} (seniority)`,
      });
      this.captureSnapshot('flagship-handover', undefined, undefined, {
        previousFlagshipId: prev,
        rule: 'seniority',
        cause: event.cause,
      });
    } else if (!st.defunct) {
      // 僚舰脱离：按当前阵型规则对剩余舰船自动补位。
      const wingmen = st.roster.filter((id) => id !== st.flagshipId);
      const flag = st.ships.get(st.flagshipId)!;
      const slots = canonicalSlots(
        st.formation === 'disperse' ? 'yanxing' : st.formation,
        wingmen.length,
      );
      st.basis = assignSlots(
        wingmen.map((id) => ({ shipId: id, pos: st.ships.get(id)!.pos })),
        flag.pos,
        flag.heading,
        slots,
      );
      this.eventLog.push({
        time: this.time,
        type: 'reslot',
        fleetId: this.fleetId,
        detail: `reslot ${wingmen.length} wingmen after detach`,
      });
      this.captureSnapshot('reslot');
    }
  }

  private activateCommandsAt(t: number): void {
    if (this.state.defunct) return;
    for (const cmd of this.effective) {
      if (cmd.status === 'superseded') continue;
      if (Math.abs(cmd.start - t) > EPS) continue;
      const runtime = this.state.cmdState.get(cmd.id);
      if (runtime?.activated) continue;
      this.state.cmdState.set(cmd.id, {
        activated: true,
        startSpeed: this.state.ships.get(this.state.flagshipId)?.speed ?? 0,
      });
      if (cmd.kind === 'formation' || cmd.kind === 'disperse') {
        this.captureSnapshot(
          cmd.kind === 'formation' ? 'formation-before' : 'disperse-before',
          cmd.id,
        );
        const st = this.state;
        const wingmen = st.roster.filter((id) => id !== st.flagshipId);
        const flag = st.ships.get(st.flagshipId)!;
        if (cmd.kind === 'formation' && cmd.formation) {
          st.formation = cmd.formation;
          const slots = canonicalSlots(cmd.formation, wingmen.length);
          st.basis = assignSlots(
            wingmen.map((id) => ({ shipId: id, pos: st.ships.get(id)!.pos })),
            flag.pos,
            flag.heading,
            slots,
          );
        } else {
          // 散开：保留当前阵型依据（相对位置）并按倍率放大。
          const k = cmd.disperseScale ?? 2;
          const basis = new Map<string, Vec2>();
          for (const id of wingmen) {
            const s = st.ships.get(id)!;
            const off = localOffset(s.pos, flag.pos, flag.heading);
            basis.set(id, { x: off.x * k, y: off.y * k });
          }
          st.basis = basis;
          st.formation = 'disperse';
        }
      }
    }
  }

  private completeCommandsAt(t: number): void {
    for (const cmd of this.effective) {
      if (cmd.status === 'superseded') continue;
      if (Math.abs(cmd.end - t) > EPS) continue;
      if (!this.state.cmdState.get(cmd.id)?.activated) continue;
      if (cmd.kind === 'formation' || cmd.kind === 'disperse') {
        this.captureSnapshot(
          cmd.kind === 'formation' ? 'formation-after' : 'disperse-after',
          cmd.id,
          cmd.status !== 'executed',
        );
      }
    }
  }

  private integrate(a: number, b: number): void {
    if (b <= a + EPS) {
      this.time = b;
      return;
    }
    this.activateCommandsAt(a);
    let t = a;
    while (t < b - EPS) {
      const h = Math.min(this.dt, b - t);
      this.step(t, h);
      t += h;
      this.time = t;
      this.stepsIntegrated += 1;
      this.recordSample();
      this.pushCheckpoint(true);
    }
    this.completeCommandsAt(b);
    // 指令完成快照落在本切片末尾：补一个检查点，
    // 使 truncateTo(b) 不会丢失已完成的 after 快照。
    this.pushCheckpoint(true);
  }

  private step(t: number, h: number): void {
    const st = this.state;
    const mid = t + h / 2;
    const active = activeCommands(this.effective, mid);
    const flag = st.ships.get(st.flagshipId);

    if (st.defunct || !flag) {
      for (const s of st.ships.values()) {
        if (!s.active) continue;
        s.pos = add(s.pos, scale(headingOf(s.heading), s.speed * h));
      }
      return;
    }

    const flagOldPos = { ...flag.pos };
    const flagOldHeading = flag.heading;
    for (const cmd of active) {
      if (cmd.kind === 'turn' && cmd.duration > 0) {
        flag.heading += ((cmd.headingDelta ?? 0) / cmd.duration) * h;
      } else if (cmd.kind === 'speed' && cmd.duration > 0) {
        const runtime = st.cmdState.get(cmd.id);
        const startSpeed = runtime?.startSpeed ?? flag.speed;
        flag.speed += (((cmd.targetSpeed ?? flag.speed) - startSpeed) / cmd.duration) * h;
      }
    }
    flag.pos = add(flag.pos, scale(headingOf(flag.heading), flag.speed * h));
    const dHeading = flag.heading - flagOldHeading;

    const formCmd = active.find(
      (c) => c.kind === 'formation' || c.kind === 'disperse',
    );
    for (const id of st.roster) {
      if (id === st.flagshipId) continue;
      const ship = st.ships.get(id);
      const offset = st.basis.get(id);
      if (!ship || !ship.active || !offset) continue;
      const oldPos = { ...ship.pos };
      // 误差随旗舰本步的刚体运动（平移 + 旋转）携带，再按增益衰减：
      // 平移 / 旋转 / 变阵下都能精确收敛到槽位，无稳态滞后。
      const targetPrev = add(flagOldPos, rotate(offset, flagOldHeading));
      const carried = rotate(sub(oldPos, targetPrev), dHeading);
      const target = add(flag.pos, rotate(offset, flag.heading));
      const factor = formCmd
        ? Math.max(0, (Math.max(formCmd.end - t, h) - h) / Math.max(formCmd.end - t, h))
        : Math.max(0, 1 - STATION_GAIN * h);
      let newPos = add(target, scale(carried, factor));
      const move = sub(newPos, oldPos);
      const cap = ship.maxSpeed * (formCmd ? FORMATION_FACTOR : CATCHUP_FACTOR);
      if (len(move) > cap * h) {
        newPos = add(oldPos, scale(move, (cap * h) / len(move)));
      }
      const vel = scale(sub(newPos, oldPos), 1 / h);
      ship.pos = newPos;
      ship.speed = len(vel);
      if (ship.speed > 1e-9) ship.heading = Math.atan2(vel.y, vel.x);
    }
  }

  private captureSnapshot(
    reason: SnapshotReason,
    commandId?: string,
    truncated?: boolean,
    handover?: FormationSnapshot['handover'],
  ): void {
    const st = this.state;
    const flag = st.ships.get(st.flagshipId);
    if (!flag) return;
    const members = st.roster.map((id) => {
      const s = st.ships.get(id)!;
      const offset =
        id === st.flagshipId
          ? { x: 0, y: 0 }
          : localOffset(s.pos, flag.pos, flag.heading);
      const world = sub(s.pos, flag.pos);
      return {
        shipId: id,
        pos: { ...s.pos },
        heading: s.heading,
        offset,
        distToFlagship: len(world),
        bearingToFlagship: Math.atan2(world.y, world.x),
      };
    });
    this.snapshots.push({
      fleetId: this.fleetId,
      time: this.time,
      reason,
      commandId,
      flagshipId: st.flagshipId,
      formation: st.formation,
      truncated,
      handover,
      members,
    });
  }
}

/** 整体重推：从场景一次性推演到 until，作为局部重推的对照基准。 */
export function simulateFleet(
  spec: FleetSpec,
  commands: FleetCommand[],
  events: SimEvent[],
  until: number,
  dt = 0.1,
): FleetSimulation {
  const sim = new FleetSimulation(spec, dt);
  sim.setCommands(commands);
  sim.setEvents(events);
  sim.advanceTo(until);
  return sim;
}
