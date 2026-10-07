import { canonicalSlots } from '../formations';
import { rotate } from '../geometry';
import type { FleetSpec, FormationType, ShipSpec } from '../types';

export interface FleetOptions {
  id?: string;
  wingmen?: number;
  formation?: FormationType;
  heading?: number;
  speed?: number;
  maxSpeed?: number;
  origin?: { x: number; y: number };
}

/** 生成一支初始即处于标准阵位的编队（旗舰 + n 僚舰）。 */
export function makeFleet(opts: FleetOptions = {}): FleetSpec {
  const {
    id = 'fleet-1',
    wingmen = 4,
    formation = 'yanxing',
    heading = 0,
    speed = 2,
    maxSpeed = 4,
    origin = { x: 0, y: 0 },
  } = opts;
  const flagshipId = `${id}-flag`;
  const ships: ShipSpec[] = [
    { id: flagshipId, pos: { ...origin }, heading, speed, maxSpeed },
  ];
  const slots = canonicalSlots(formation, wingmen);
  slots.forEach((slot, i) => {
    const off = rotate(slot, heading);
    ships.push({
      id: `${id}-w${i + 1}`,
      pos: { x: origin.x + off.x, y: origin.y + off.y },
      heading,
      speed,
      maxSpeed,
    });
  });
  return {
    id,
    roster: ships.map((s) => s.id),
    flagshipId,
    formation,
    ships,
  };
}

export const shipIds = (spec: FleetSpec): string[] => spec.ships.map((s) => s.id);
