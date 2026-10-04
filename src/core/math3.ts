export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export const v3 = {
  add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a: Vec3, s: number): Vec3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  },
  length(a: Vec3): number {
    return Math.hypot(a[0], a[1], a[2]);
  },
  lengthSq(a: Vec3): number {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  },
  normalize(a: Vec3): Vec3 {
    const len = v3.length(a);
    return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  },
  distance(a: Vec3, b: Vec3): number {
    return v3.length(v3.sub(a, b));
  }
};

export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const f = v3.normalize(from);
  const t = v3.normalize(to);
  const dot = Math.min(Math.max(v3.dot(f, t), -1), 1);
  if (dot < -0.999999) {
    const tmp: Vec3 = v3.cross([1, 0, 0], f);
    if (v3.lengthSq(tmp) < 1e-12) {
      const alt: Vec3 = v3.cross([0, 1, 0], f);
      return quatFromAxisAngle(v3.normalize(alt), Math.PI);
    }
    return quatFromAxisAngle(v3.normalize(tmp), Math.PI);
  }
  const c = v3.cross(f, t);
  const s = Math.sqrt((1 + dot) * 2);
  const inv = 1 / s;
  return [c[0] * inv, c[1] * inv, c[2] * inv, s * 0.5];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

export function identityMat4(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as Mat4;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function perspectiveMatrix(
  fovYDegrees: number,
  aspect: number,
  near: number,
  far: number
): Mat4 {
  const f = 1 / Math.tan((fovYDegrees * Math.PI / 180) / 2);
  const nf = 1 / (near - far);
  const out = new Array(16).fill(0) as Mat4;
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAtMatrix(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = v3.normalize(v3.sub(eye, target));
  const x = v3.normalize(v3.cross(up, z));
  const y = v3.cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1
  ];
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w
  ];
}

export function viewProjectionMatrix(
  position: Vec3,
  target: Vec3,
  up: Vec3,
  fovYDegrees: number,
  aspect: number,
  near: number,
  far: number
): Mat4 {
  return multiplyMat4(
    perspectiveMatrix(fovYDegrees, aspect, near, far),
    lookAtMatrix(position, target, up)
  );
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export function raySphereIntersection(ray: Ray, center: Vec3, radius: number): number | null {
  const oc = v3.sub(ray.origin, center);
  const b = v3.dot(oc, ray.direction);
  const c = v3.dot(oc, oc) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const sqrtD = Math.sqrt(discriminant);
  const t1 = -b - sqrtD;
  const t2 = -b + sqrtD;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

export function applyQuat(q: Quat, v: Vec3): Vec3 {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx
  ];
}
