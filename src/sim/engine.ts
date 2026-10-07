import { FleetSimulation } from './fleetSim';
import type {
  DetachCause,
  EffectiveCommand,
  EventRecord,
  FleetCommand,
  FleetSpec,
  FormationSnapshot,
  ShipState,
  SimEvent,
} from './types';

export interface EngineStats {
  fleetId: string;
  stepsIntegrated: number;
  simulatedUntil: number;
}

/**
 * 多编队指挥引擎：维护指令链与事件，只对受影响编队 / 时间区间做局部重推。
 * - 下达指令：该编队回滚到指令生效时刻，重新推演到当前时刻。
 * - 僚舰脱离 / 旗舰移除：该编队回滚到事件时刻再前推，其他编队不动。
 */
export class FleetEngine {
  readonly dt: number;
  now = 0;

  private specs = new Map<string, FleetSpec>();
  private sims = new Map<string, FleetSimulation>();
  private commands: FleetCommand[] = [];
  private events: SimEvent[] = [];

  constructor(dt = 0.1) {
    this.dt = dt;
  }

  addFleet(spec: FleetSpec): void {
    const sim = new FleetSimulation(spec, this.dt);
    this.specs.set(spec.id, spec);
    this.sims.set(spec.id, sim);
    this.refresh(spec.id, 0);
  }

  issueCommand(cmd: FleetCommand): void {
    this.commands.push(cmd);
    this.refresh(cmd.fleetId, cmd.issuedAt);
  }

  /** 僚舰触礁 / 受损脱离；若移除的是旗舰，由推演器执行移交并重推指令链。 */
  detachShip(
    fleetId: string,
    shipId: string,
    time: number,
    cause: DetachCause,
  ): void {
    this.events.push({ time, type: 'detach', fleetId, shipId, cause });
    this.refresh(fleetId, time);
  }

  advanceTo(t: number): void {
    for (const sim of this.sims.values()) sim.advanceTo(t);
    this.now = t;
  }

  /** 任意时刻每艘船的确定位置 / 朝向 / 所属编队。 */
  stateAt(t: number): { time: number; ships: ShipState[] } {
    let time = t;
    const ships: ShipState[] = [];
    for (const sim of this.sims.values()) {
      const sample = sim.stateAt(t);
      time = sample.time;
      ships.push(...sample.ships);
    }
    return { time, ships };
  }

  commandChain(fleetId?: string): EffectiveCommand[] {
    const sims = fleetId ? [this.requireSim(fleetId)] : [...this.sims.values()];
    return sims
      .flatMap((s) => s.getCommandChain())
      .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  }

  snapshots(fleetId?: string): FormationSnapshot[] {
    const sims = fleetId ? [this.requireSim(fleetId)] : [...this.sims.values()];
    return sims.flatMap((s) => s.getSnapshots()).sort((a, b) => a.time - b.time);
  }

  eventLog(fleetId?: string): EventRecord[] {
    const sims = fleetId ? [this.requireSim(fleetId)] : [...this.sims.values()];
    return sims.flatMap((s) => s.getEventLog()).sort((a, b) => a.time - b.time);
  }

  flagshipId(fleetId: string): string {
    return this.requireSim(fleetId).getFlagshipId();
  }

  roster(fleetId: string): string[] {
    return this.requireSim(fleetId).getRoster();
  }

  stats(): EngineStats[] {
    return [...this.sims.values()].map((s) => ({
      fleetId: s.fleetId,
      stepsIntegrated: s.stepsIntegrated,
      simulatedUntil: s.currentTime,
    }));
  }

  /** 整体重推基准：把全部指令与事件一次性推演，供一致性对照。 */
  fullRecompute(fleetId: string, until: number): FleetSimulation {
    const spec = this.specs.get(fleetId);
    if (!spec) throw new Error(`unknown fleet: ${fleetId}`);
    const sim = new FleetSimulation(spec, this.dt);
    sim.setCommands(this.commands);
    sim.setEvents(this.events);
    sim.advanceTo(until);
    return sim;
  }

  private requireSim(fleetId: string): FleetSimulation {
    const sim = this.sims.get(fleetId);
    if (!sim) throw new Error(`unknown fleet: ${fleetId}`);
    return sim;
  }

  private refresh(fleetId: string, affectedAt: number): void {
    const sim = this.requireSim(fleetId);
    sim.setCommands(this.commands);
    sim.setEvents(this.events);
    const target = sim.currentTime;
    sim.truncateTo(Math.min(affectedAt, target));
    sim.advanceTo(target);
  }
}
