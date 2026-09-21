/* math3d.js - minimal 3D math: vec3, TRS matrices, ray/OBB. Works in browser and Node. */
(function (root, factory) {
  const M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else root.Math3D = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const rad = (d) => (d * Math.PI) / 180;

  const v3 = (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 });
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const l = len(a) || 1; return mul(a, 1 / l); };

  // Row-major 4x4. Rotation order: Rz * Ry * Rx (apply X, then Y, then Z).
  function rotMatrix(rDeg) {
    const cx = Math.cos(rad(rDeg.x)), sx = Math.sin(rad(rDeg.x));
    const cy = Math.cos(rad(rDeg.y)), sy = Math.sin(rad(rDeg.y));
    const cz = Math.cos(rad(rDeg.z)), sz = Math.sin(rad(rDeg.z));
    return [
      cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
      sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
      -sy, cy * sx, cy * cx,
    ];
  }

  // World = T * R * S  (scale applied first, in the part's local frame)
  function composeTRS(p, rDeg, s) {
    const R = rotMatrix(rDeg);
    return [
      R[0] * s.x, R[1] * s.y, R[2] * s.z, p.x,
      R[3] * s.x, R[4] * s.y, R[5] * s.z, p.y,
      R[6] * s.x, R[7] * s.y, R[8] * s.z, p.z,
      0, 0, 0, 1,
    ];
  }

  // Inverse of composeTRS: S^-1 * R^T * T^-1
  function invertTRS(p, rDeg, s) {
    const R = rotMatrix(rDeg);
    const m = new Array(16);
    for (let i = 0; i < 3; i++) {
      const si = i === 0 ? s.x : i === 1 ? s.y : s.z;
      for (let j = 0; j < 3; j++) m[i * 4 + j] = R[j * 3 + i] / si;
      m[i * 4 + 3] = -(m[i * 4] * p.x + m[i * 4 + 1] * p.y + m[i * 4 + 2] * p.z);
    }
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
  }

  function transformPoint(m, v) {
    return v3(
      m[0] * v.x + m[1] * v.y + m[2] * v.z + m[3],
      m[4] * v.x + m[5] * v.y + m[6] * v.z + m[7],
      m[8] * v.x + m[9] * v.y + m[10] * v.z + m[11]
    );
  }

  function transformDir(m, v) {
    return v3(
      m[0] * v.x + m[1] * v.y + m[2] * v.z,
      m[4] * v.x + m[5] * v.y + m[6] * v.z,
      m[8] * v.x + m[9] * v.y + m[10] * v.z
    );
  }

  // Ray vs axis-aligned box centered at origin with half extents `half`.
  // Returns { t, point, normal } for nearest positive hit, or null.
  function rayBox(ro, rd, half) {
    let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    const roA = [ro.x, ro.y, ro.z], rdA = [rd.x, rd.y, rd.z], hA = [half.x, half.y, half.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(rdA[i]) < 1e-12) {
        if (Math.abs(roA[i]) > hA[i]) return null;
        continue;
      }
      const inv = 1 / rdA[i];
      let t1 = (-hA[i] - roA[i]) * inv, t2 = (hA[i] - roA[i]) * inv;
      let s = -Math.sign(rdA[i]);
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = -s; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmax < 0) return null;
    const t = tmin >= 0 ? tmin : tmax;
    if (axis < 0) return null;
    const p = v3(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t);
    const n = v3(0, 0, 0);
    if (axis === 0) n.x = sign; else if (axis === 1) n.y = sign; else n.z = sign;
    return { t, point: p, normal: n };
  }

  return { rad, v3, add, sub, mul, dot, cross, len, norm, rotMatrix, composeTRS, invertTRS, transformPoint, transformDir, rayBox };
});
