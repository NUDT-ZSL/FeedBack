/* render.js - orbit camera, perspective projection, canvas box rendering. */
(function (root) {
  'use strict';
  const M3 = root.Math3D;

  const camera = {
    target: M3.v3(0, 0.5, 0),
    theta: 0.8,      // azimuth (rad)
    phi: 1.05,       // polar (rad from +Y)
    dist: 9,
    fov: 800,        // focal length in px (scaled by canvas size at draw time)
  };

  function eye() {
    const sp = Math.sin(camera.phi), cp = Math.cos(camera.phi);
    const st = Math.sin(camera.theta), ct = Math.cos(camera.theta);
    return M3.v3(
      camera.target.x + camera.dist * sp * st,
      camera.target.y + camera.dist * cp,
      camera.target.z + camera.dist * sp * ct
    );
  }

  function basis() {
    const e = eye();
    const fwd = M3.norm(M3.sub(camera.target, e));
    const right = M3.norm(M3.cross(fwd, M3.v3(0, 1, 0)));
    const up = M3.cross(right, fwd);
    return { e, fwd, right, up };
  }

  // Project world point -> { x, y, z } screen px (z = depth, <=0 behind camera)
  function project(p, b, w, h) {
    b = b || basis();
    const d = M3.sub(p, b.e);
    const z = M3.dot(d, b.fwd);
    const f = camera.fov * (Math.min(w, h) / 900);
    return {
      x: w / 2 + (M3.dot(d, b.right) * f) / Math.max(z, 1e-6),
      y: h / 2 - (M3.dot(d, b.up) * f) / Math.max(z, 1e-6),
      z,
    };
  }

  // Inverse of project: ray through pixel (px, py)
  function screenRay(px, py, w, h) {
    const b = basis();
    const f = camera.fov * (Math.min(w, h) / 900);
    const dir = M3.norm(M3.add(
      M3.add(b.fwd, M3.mul(b.right, (px - w / 2) / f)),
      M3.mul(b.up, -(py - h / 2) / f)
    ));
    return { origin: b.e, dir };
  }

  const CORNERS = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) CORNERS.push([sx, sy, sz]);
  // CORNERS index: 0:(-,-,-) 1:(-,-,+) 2:(-,+,-) 3:(-,+,+) 4:(+,-,-) 5:(+,-,+) 6:(+,+,-) 7:(+,+,+)
  const FACE_IDX = [
    [0, 1, 3, 2], [4, 6, 7, 5], // x-, x+
    [0, 2, 6, 4], [1, 5, 7, 3], // z-, z+
    [0, 4, 5, 1], [2, 3, 7, 6], // y-, y+
  ];

  function partCorners(part) {
    const m = root.Scene.partMatrix(part);
    const h = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
    return CORNERS.map((c) => M3.transformPoint(m, M3.v3(c[0] * h.x, c[1] * h.y, c[2] * h.z)));
  }

  function drawScene(ctx, w, h, selectedPartId) {
    ctx.clearRect(0, 0, w, h);
    const b = basis();
    drawGrid(ctx, b, w, h);
    // painter's sort faces across all parts
    const faces = [];
    for (const part of root.Scene.state.parts) {
      const wc = partCorners(part);
      const sc = wc.map((p) => project(p, b, w, h));
      FACE_IDX.forEach((idx, fi) => {
        const pts = idx.map((i) => sc[i]);
        const z = idx.reduce((s, i) => s + sc[i].z, 0) / 4;
        faces.push({ part, pts, z, fi });
      });
    }
    faces.sort((a, b2) => b2.z - a.z); // far first (larger z = farther)
    for (const f of faces) {
      if (f.z <= 0.05) continue;
      const sel = f.part.id === selectedPartId;
      const shade = 0.55 + 0.45 * ((f.fi % 3) / 2);
      ctx.beginPath();
      ctx.moveTo(f.pts[0].x, f.pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = sel
        ? 'rgba(96,165,250,' + (0.35 + 0.3 * shade) + ')'
        : 'rgba(120,144,180,' + (0.25 + 0.3 * shade) + ')';
      ctx.fill();
      ctx.strokeStyle = sel ? '#93c5fd' : 'rgba(180,200,230,0.8)';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.stroke();
    }
  }

  function drawGrid(ctx, b, w, h) {
    ctx.strokeStyle = 'rgba(120,130,150,0.25)';
    ctx.lineWidth = 1;
    for (let i = -5; i <= 5; i++) {
      line(ctx, project(M3.v3(i, 0, -5), b, w, h), project(M3.v3(i, 0, 5), b, w, h));
      line(ctx, project(M3.v3(-5, 0, i), b, w, h), project(M3.v3(5, 0, i), b, w, h));
    }
    ctx.strokeStyle = 'rgba(150,160,190,0.5)';
    line(ctx, project(M3.v3(0, 0, 0), b, w, h), project(M3.v3(1.5, 0, 0), b, w, h));
  }

  function line(ctx, a, b2) {
    if (a.z <= 0.05 || b2.z <= 0.05) return;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
  }

  root.Render = { camera, eye, basis, project, screenRay, drawScene };
})(typeof self !== 'undefined' ? self : this);
