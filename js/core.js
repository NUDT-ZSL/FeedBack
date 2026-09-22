(function () {
  "use strict";
  const EPS = 1e-6;
  const DP = (window.DemoPlanner = window.DemoPlanner || {});

  DP.num = function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  DP.uid = function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  };

  DP.orientations = function orientations(cargo) {
    const d = [DP.num(cargo.l), DP.num(cargo.w), DP.num(cargo.h)];
    const keys = ["长", "宽", "高"];
    let indexes;
    if (cargo.flippable) {
      indexes = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
    } else if (cargo.rotatable) {
      indexes = [[0,1,2],[1,0,2]];
    } else {
      indexes = [[0,1,2]];
    }
    const seen = new Set();
    return indexes
      .map((idx) => ({ l: d[idx[0]], w: d[idx[1]], h: d[idx[2]],
        label: `${d[idx[0]]}×${d[idx[1]]}×${d[idx[2]]}（${keys[idx[0]]}/${keys[idx[1]]}/${keys[idx[2]]}）` }))
      .filter((o) => {
        const key = `${o.l}/${o.w}/${o.h}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  DP.rectOverlap = function rectOverlap(a, b) {
    const x = overlap(a.x, a.x + a.l, b.x, b.x + b.l);
    const y = overlap(a.y, a.y + a.w, b.y, b.y + b.w);
    return { x, y, area: x * y };
  };

  DP.intersects = function intersects(a, b) {
    return overlap(a.x, a.x + a.l, b.x, b.x + b.l) > EPS &&
      overlap(a.y, a.y + a.w, b.y, b.y + b.w) > EPS &&
      overlap(a.z, a.z + a.h, b.z, b.z + b.h) > EPS;
  };

  function supportRecords(p, placements) {
    const records = [];
    if (p.z <= EPS) return records;
    for (const q of placements) {
      if (q.id === p.id || Math.abs(q.z + q.h - p.z) > EPS) continue;
      const hit = DP.rectOverlap(p, q);
      if (hit.area > EPS) records.push({ id: q.id, area: hit.area });
    }
    return records;
  }

  DP.supportArea = function supportArea(p, placements) {
    if (p.z <= EPS) return p.l * p.w;
    return supportRecords(p, placements).reduce((sum, r) => sum + r.area, 0);
  };

  DP.analyzeStack = function analyzeStack(placements, cargoById) {
    const byId = new Map(placements.map((p) => [p.id, p]));
    const eff = new Map();
    const load = new Map();
    const violations = [];
    placements.forEach((p) => { eff.set(p.id, DP.num(cargoById.get(p.id)?.weight)); load.set(p.id, 0); });
    const ordered = [...placements].sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));

    for (const p of ordered) {
      const relevant = supportRecords(p, placements);
      const total = relevant.reduce((s, r) => s + r.area, 0);
      const pressure = (eff.get(p.id) || 0) + (load.get(p.id) || 0);
      if (p.z > EPS) {
        if (total <= EPS) violations.push(`${p.label || p.id} 悬空，无有效支撑`);
        const upper = cargoById.get(p.id);
        if (upper && !upper.stackable) violations.push(`${upper.name} 标记为不可堆叠，不能置于其他货物上方`);
        for (const r of relevant) {
          const lower = cargoById.get(r.id);
          if (!lower.stackable) violations.push(`${lower.name} 不可堆叠，却承载了 ${cargoById.get(p.id)?.name || p.id}`);
          const share = pressure * r.area / total;
          load.set(r.id, (load.get(r.id) || 0) + share);
        }
      }
    }
    for (const p of placements) {
      const cargo = cargoById.get(p.id);
      const got = load.get(p.id) || 0;
      if (cargo && got > DP.num(cargo.loadCapacity) + 1e-5) {
        violations.push(`${cargo.name} 承重超限：上方分配 ${got.toFixed(1)}kg / 可承 ${DP.num(cargo.loadCapacity)}kg`);
      }
    }
    return { effectiveWeight: eff, load, violations };
  };

  DP.isAdjacent = function isAdjacent(a, b) {
    const ox = overlap(a.x, a.x+a.l, b.x, b.x+b.l);
    const oy = overlap(a.y, a.y+a.w, b.y, b.y+b.w);
    const oz = overlap(a.z, a.z+a.h, b.z, b.z+b.h);
    const gapX = Math.min(Math.abs(a.x - (b.x+b.l)), Math.abs(b.x - (a.x+a.l)));
    const gapY = Math.min(Math.abs(a.y - (b.y+b.w)), Math.abs(b.y - (a.y+a.w)));
    const gapZ = Math.min(Math.abs(a.z - (b.z+b.h)), Math.abs(b.z - (a.z+a.h)));
    return (ox > EPS && oy > EPS && gapZ <= EPS) ||
           (ox > EPS && oz > EPS && gapY <= EPS) ||
           (oy > EPS && oz > EPS && gapX <= EPS);
  };

  DP.freeSpace = function freeSpace(bin, placements) {
    const volume = bin.l * bin.w * bin.h;
    const usedVolume = placements.reduce((s, p) => s + p.l * p.w * p.h, 0);
    const usedWeight = placements.reduce((s, p) => s + DP.num(p.weight), 0);
    const top = placements.reduce((m, p) => Math.max(m, p.z + p.h), 0);
    return {
      freeVolume: Math.max(0, volume - usedVolume),
      volume,
      usedVolume,
      freeWeight: Math.max(0, DP.num(bin.maxWeight) - usedWeight),
      maxWeight: DP.num(bin.maxWeight),
      usedWeight,
      freeHeight: Math.max(0, bin.h - top),
      top
    };
  };
})();
