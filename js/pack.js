(function () {
  "use strict";
  const DP = window.DemoPlanner;
  const EPS = 1e-6;

  function cargoMap(cargos) {
    return new Map(cargos.map((c) => [c.id, c]));
  }

  function expandBins(specs) {
    const bins = [];
    specs.filter((spec) => DP.num(spec.count) > 0).forEach((spec) => {
      for (let i = 0; i < Math.floor(DP.num(spec.count)); i++) {
        bins.push({
          id: `${spec.id}#${i + 1}`,
          typeId: spec.id,
          name: `${spec.name || spec.id} ${i + 1}`,
          l: DP.num(spec.l), w: DP.num(spec.w), h: DP.num(spec.h),
          maxWeight: DP.num(spec.maxWeight),
          placements: []
        });
      }
    });
    return bins;
  }

  function coordinateSet(bin, placements, size, axis) {
    const max = axis === "x" ? bin.l - size.l : axis === "y" ? bin.w - size.w : bin.h - size.h;
    const values = new Set([0]);
    for (const p of placements) {
      if (axis === "x") [p.x, p.x + p.l].forEach((v) => values.add(v));
      if (axis === "y") [p.y, p.y + p.w].forEach((v) => values.add(v));
      if (axis === "z") [0, p.z + p.h].forEach((v) => values.add(v));
    }
    return [...values].filter((v) => v >= -EPS && v <= max + EPS).sort((a, b) => a - b);
  }

  function validPlacement(cargo, orientation, x, y, z, bin, bins, byId, options) {
    const p = {
      id: cargo.id, name: cargo.name, color: cargo.color || "#60a5fa",
      x, y, z, l: orientation.l, w: orientation.w, h: orientation.h,
      orientation: orientation.label,
      weight: DP.num(cargo.weight), loadCapacity: DP.num(cargo.loadCapacity)
    };
    if (x + p.l > bin.l + EPS || y + p.w > bin.w + EPS || z + p.h > bin.h + EPS) return null;
    if (bin.placements.some((q) => DP.intersects(p, q))) return null;

    const below = bin.placements.filter((q) => Math.abs(q.z + q.h - z) <= EPS &&
      DP.rectOverlap(p, q).area > EPS);
    if (z > EPS) {
      if (!cargo.stackable) return null;
      const area = below.reduce((s, q) => s + DP.rectOverlap(p, q).area, 0);
      if (area < p.l * p.w * options.supportRatio - EPS) return null;
      if (below.some((q) => !byId.get(q.id)?.stackable)) return null;
    }
    const trial = bin.placements.concat(p);
    const analysis = DP.analyzeStack(trial, byId);
    if (analysis.violations.length) return null;
    const totalWeight = trial.reduce((s, q) => s + DP.num(q.weight), 0);
    if (totalWeight > bin.maxWeight + EPS) return null;

    for (const r of options.relations) {
      const otherId = r.a === cargo.id ? r.b : r.b === cargo.id ? r.a : null;
      if (!otherId) continue;
      const otherBin = bins.find((b) => b.placements.some((q) => q.id === otherId));
      const other = otherBin?.placements.find((q) => q.id === otherId);
      if (r.type === "incompatible" && otherBin === bin) return null;
      if (r.type === "adjacent") {
        if (otherBin && otherBin !== bin) return null;
        if (other && !DP.isAdjacent(p, other)) return null;
      }
    }
    return { bin, p, below, analysis };
  }

  function enumerateCandidates(cargo, bins, byId, options, allowNew) {
    const result = [];
    const active = bins.filter((b) => b.placements.length || !b.fresh);
    for (const bin of bins) {
      for (const orientation of DP.orientations(cargo)) {
        const xs = coordinateSet(bin, bin.placements, orientation, "x");
        const ys = coordinateSet(bin, bin.placements, orientation, "y");
        const zs = coordinateSet(bin, bin.placements, orientation, "z");
        for (const z of zs) for (const y of ys) for (const x of xs) {
          const made = validPlacement(cargo, orientation, x, y, z, bin, bins, byId, options);
          if (made) result.push(made);
        }
      }
    }
    return dedupeAndRank(result, bins);
  }

  function dedupeAndRank(candidates) {
    const map = new Map();
    for (const c of candidates) {
      const key = `${c.bin.id}/${c.p.x},${c.p.y},${c.p.z}/${c.p.l}x${c.p.w}x${c.p.h}`;
      if (!map.has(key)) map.set(key, c);
    }
    return [...map.values()].map((c) => {
      const p = c.p;
      const supportRatio = p.z <= EPS ? 1 :
        c.below.reduce((s, q) => s + DP.rectOverlap(p, q).area, 0) / (p.l * p.w);
      const utilization = c.bin.placements.reduce((s, q) => s + q.l*q.w*q.h, 0) /
        (c.bin.l * c.bin.w * c.bin.h);
      c.score = (c.bin.placements.length ? 0 : 100000) +
        p.z * 100 + (p.x / c.bin.l + p.y / c.bin.w) * 20 -
        supportRatio * 30 - utilization * 15;
      return c;
    }).sort((a, b) => a.score - b.score);
  }

  DP.expandBins = expandBins;
  DP.cargoMap = cargoMap;
  DP.enumerateCandidates = enumerateCandidates;
})();
