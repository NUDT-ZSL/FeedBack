// 纯数学拾取核心：不依赖 three.js，可在 Node 中独立测试。
// 零件模型: { id, name, parentId, opaque, box: { min:[x,y,z], max:[x,y,z] }, visible }

export function rayAABB(origin, dir, box) {
  // slab 法，返回进入距离 t（射线在盒内起始时为 0），未命中返回 null
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin[i], d = dir[i];
    const mn = box.min[i], mx = box.max[i];
    if (Math.abs(d) < 1e-12) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : 0;
}

export function boxCenter(box) {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

export function boxSize(box) {
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// 沿视线求全部候选并按进入距离排序，标注遮挡关系。
// 规则：候选 c 被遮挡 <=> 存在另一个可见且不透明的零件 p，其进入距离更小。
// 返回 { selected, candidates: [{part, t, occluded, occluders:[partId]}] }
export function computePick(parts, origin, dir) {
  const hits = [];
  for (const p of parts) {
    if (p.visible === false) continue;
    const t = rayAABB(origin, dir, p.box);
    if (t === null) continue;
    hits.push({ part: p, t });
  }
  hits.sort((a, b) => a.t - b.t || (a.part.id < b.part.id ? -1 : 1));
  const candidates = hits.map(h => {
    const occluders = hits
      .filter(o => o !== h && o.t < h.t - 1e-9 && o.part.opaque !== false)
      .map(o => o.part.id);
    return { part: h.part, t: h.t, occluded: occluders.length > 0, occluders };
  });
  const selected = candidates.find(c => !c.occluded) || null;
  return { selected, candidates };
}

// 从观察点检查某零件当前是否被遮挡（用于视角转动后的选中保持判定）。
// 返回 { visible, occluders:[part], nearestVisible } —— nearestVisible 为视线上当前可见的零件。
export function checkOcclusion(parts, eye, targetId) {
  const target = parts.find(p => p.id === targetId);
  if (!target) return { visible: false, occluders: [], nearestVisible: null, missing: true };
  if (target.visible === false) {
    return { visible: false, occluders: [], nearestVisible: null, hidden: true };
  }
  const center = boxCenter(target.box);
  const dir = norm(sub(center, eye));
  const tTarget = rayAABB(eye, dir, target.box);
  const occluders = [];
  let nearestVisible = null, nearestT = Infinity;
  for (const p of parts) {
    if (p.id === targetId || p.visible === false) continue;
    const t = rayAABB(eye, dir, p.box);
    if (t === null || t >= tTarget - 1e-9) continue;
    if (t < nearestT) { nearestT = t; nearestVisible = p; }
    if (p.opaque !== false) occluders.push(p);
  }
  occluders.sort((a, b) => rayAABB(eye, dir, a.box) - rayAABB(eye, dir, b.box));
  return { visible: occluders.length === 0, occluders, nearestVisible };
}
