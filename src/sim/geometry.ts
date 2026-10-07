export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });

export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

/** Rotate vector by heading (radians, CCW, 0 = +x). */
export const rotate = (a: Vec2, heading: number): Vec2 => {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

export const headingOf = (heading: number): Vec2 => ({
  x: Math.cos(heading),
  y: Math.sin(heading),
});

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Normalize an angle to (-PI, PI]. */
export const normalizeAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
};
