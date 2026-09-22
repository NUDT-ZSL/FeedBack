(function () {
  "use strict";
  const DP = window.DemoPlanner;

  function cleanCargo(c, index) {
    return {
      id: String(c.id || `C${index + 1}`),
      name: String(c.name || c.id || `货物${index + 1}`),
      l: DP.num(c.l), w: DP.num(c.w), h: DP.num(c.h),
      weight: DP.num(c.weight), loadCapacity: DP.num(c.loadCapacity),
      stackable: c.stackable !== false,
      rotatable: c.rotatable !== false,
      flippable: c.flippable === true,
      color: c.color || null
    };
  }

  function cleanBin(b, index) {
    return {
      id: String(b.id || `B${index + 1}`),
      name: String(b.name || b.id || `容器${index + 1}`),
      l: DP.num(b.l), w: DP.num(b.w), h: DP.num(b.h),
      maxWeight: DP.num(b.maxWeight),
      count: Math.max(0, Math.floor(DP.num(b.count, 1)))
    };
  }

  function normalize(input) {
    const containers = (input.containers || []).map(cleanBin);
    const cargos = (input.cargos || []).map(cleanCargo);
    const palette = ["#2563eb","#0891b2","#059669","#d97706","#dc2626","#7c3aed","#0f766e","#be123c","#4d7c0f","#9333ea"];
    cargos.forEach((c, i) => { if (!c.color) c.color = palette[i % palette.length]; });
    const relations = (input.relations || []).map((r, i) => ({
      id: String(r.id || `R${i + 1}`),
      a: String(r.a), b: String(r.b),
      type: r.type === "adjacent" ? "adjacent" : "incompatible"
    })).filter((r) => r.a !== r.b && cargos.some(c => c.id === r.a) && cargos.some(c => c.id === r.b));
    return {
      containers,
      cargos,
      relations,
      supportRatio: Math.min(1, Math.max(0.5, DP.num(input.supportRatio, 0.9)))
    };
  }

  function orderCargos(cargos, relations, variant) {
    const byId = new Map(cargos.map((c) => [c.id, c]));
    const degree = new Map(cargos.map((c) => [c.id, 0]));
    relations.filter((r) => r.type === "adjacent").forEach((r) => {
      degree.set(r.a, (degree.get(r.a) || 0) + 1);
      degree.set(r.b, (degree.get(r.b) || 0) + 1);
    });
    const score = (c) => {
      const volume = c.l * c.w * c.h;
      let v = volume;
      if (variant === 1) v = c.l * c.w;
      if (variant === 2) v = c.loadCapacity;
      if (variant === 3) v = c.weight;
      if (variant === 4) v = c.h * c.l * c.w;
      if (variant === 5) v = volume * 0.7 + c.weight * c.l * c.w * 0.3;
      if (variant === 6) v = -c.weight;
      if (variant === 7) v = volume * (0.85 + Math.random() * 0.3);
      return v + (degree.get(c.id) || 0) * 1e7;
    };
    const sorted = [...cargos].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const links = new Map(cargos.map((c) => [c.id, []]));
    relations.filter((r) => r.type === "adjacent").forEach((r) => {
      links.get(r.a).push(r.b); links.get(r.b).push(r.a);
    });
    const seen = new Set();
    const result = [];
    for (const start of sorted) {
      if (seen.has(start.id)) continue;
      const stack = [start.id];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(byId.get(id));
        links.get(id).sort((x, y) => score(byId.get(y)) - score(byId.get(x))).forEach((n) => {
          if (!seen.has(n)) stack.push(n);
        });
      }
    }
    return result;
  }

  function solveOnce(data, variant, nodeLimit = 2500) {
    const bins = DP.expandBins(data.containers);
    const byId = DP.cargoMap(data.cargos);
    const ordered = orderCargos(data.cargos, data.relations, variant);
    let nodes = 0;
    let best = { bins, index: 0, used: 0, nodes: 0 };

    function snapshot(index, used) {
      if (index > best.index || (index === best.index && used < best.used)) {
        best = {
          bins: bins.map((b) => ({ ...b, placements: b.placements.map((p) => ({ ...p })) })),
          index, used, nodes
        };
      }
    }
    function dfs(index) {
      if (index === ordered.length) { snapshot(index, bins.filter(b => b.placements.length).length); return true; }
      if (++nodes > nodeLimit) return false;
      const cargo = ordered[index];
      const candidates = DP.enumerateCandidates(cargo, bins, byId, data);
      const branchLimit = variant === 7 ? 5 : 8;
      for (const candidate of candidates.slice(0, branchLimit)) {
        candidate.bin.placements.push(candidate.p);
        snapshot(index + 1, bins.filter(b => b.placements.length).length);
        if (dfs(index + 1)) return true;
        candidate.bin.placements.pop();
      }
      return false;
    }
    dfs(0);
    return best;
  }

  DP.normalizePlanningData = normalize;
  DP.solveOnce = solveOnce;

  function validatePlan(data, bins) {
    const byId = DP.cargoMap(data.cargos);
    const issues = [];
    const seen = new Set();
    bins.forEach((bin) => {
      const space = DP.freeSpace(bin, bin.placements);
      if (space.usedWeight > bin.maxWeight + 1e-5) {
        issues.push(`${bin.name} 总重 ${space.usedWeight.toFixed(1)}kg 超过 ${bin.maxWeight}kg`);
      }
      bin.placements.forEach((p) => {
        if (seen.has(p.id)) issues.push(`${p.name} 被重复摆放`);
        seen.add(p.id);
        if (p.x+p.l > bin.l+1e-6 || p.y+p.w > bin.w+1e-6 || p.z+p.h > bin.h+1e-6) {
          issues.push(`${p.name} 超出 ${bin.name} 边界`);
        }
        const support = DP.supportArea(p, bin.placements);
        if (support < p.l*p.w*data.supportRatio - 1e-5) {
          issues.push(`${p.name} 支撑面积不足`);
        }
      });
      DP.analyzeStack(bin.placements, byId).violations.forEach((v) => issues.push(v));
      for (let i=0; i<bin.placements.length; i++) {
        for (let j=i+1; j<bin.placements.length; j++) {
          if (DP.intersects(bin.placements[i], bin.placements[j])) {
            issues.push(`${bin.placements[i].name} 与 ${bin.placements[j].name} 发生体积碰撞`);
          }
        }
      }
    });
    data.relations.forEach((r) => {
      const a = data.cargos.find(c => c.id === r.a);
      const b = data.cargos.find(c => c.id === r.b);
      const pa = bins.flatMap(x => x.placements.map(p => [x,p])).find(([,p]) => p.id === r.a);
      const pb = bins.flatMap(x => x.placements.map(p => [x,p])).find(([,p]) => p.id === r.b);
      if (!pa || !pb) return;
      if (r.type === "incompatible" && pa[0] === pb[0]) {
        issues.push(`互斥冲突：${a.name} 与 ${b.name} 被放入同一容器`);
      }
      if (r.type === "adjacent" && (pa[0] !== pb[0] || !DP.isAdjacent(pa[1], pb[1]))) {
        issues.push(`相邻约束未满足：${a.name} 与 ${b.name}`);
      }
    });
    return issues;
  }

  function fitsContainer(cargo, bin) {
    return DP.num(cargo.weight) <= DP.num(bin.maxWeight) &&
      DP.orientations(cargo).some(o => o.l <= bin.l && o.w <= bin.w && o.h <= bin.h);
  }

  function diagnose(data, bins, placed) {
    const unplaced = data.cargos.filter(c => !placed.has(c.id));
    const reasons = [];
    const tooBig = unplaced.filter(c => !data.containers.some(b => fitsContainer(c, b)));
    if (tooBig.length) reasons.push(`现有任何容器型号都放不下：${tooBig.map(c => c.name).join("、")}`);
    data.relations.forEach((r) => {
      if (unplaced.some(c => c.id === r.a || c.id === r.b)) {
        const a = data.cargos.find(c => c.id === r.a);
        const b = data.cargos.find(c => c.id === r.b);
        reasons.push(`${r.type === "adjacent" ? "必须相邻" : "不可同放"}关系涉及未安置货物：${a.name}、${b.name}`);
      }
    });
    const totalWeight = data.cargos.reduce((s,c) => s+c.weight,0);
    const capWeight = data.containers.reduce((s,b) => s+b.maxWeight*b.count,0);
    if (totalWeight > capWeight + 1e-6) {
      reasons.push(`总承重不足：货物 ${totalWeight.toFixed(1)}kg，当前容器合计 ${capWeight.toFixed(1)}kg`);
    }
    if (!reasons.length && unplaced.length) {
      reasons.push(`回溯搜索未能给 ${unplaced.map(c=>c.name).join("、")} 找到同时满足尺寸、支撑、承重和关系的落点`);
    }
    return reasons;
  }

  function plan(input) {
    const data = normalize(input);
    const attempts = [];
    for (let variant = 0; variant < 8; variant++) {
      const result = solveOnce(data, variant);
      const used = result.bins.filter(b => b.placements.length).length;
      const compact = result.bins.reduce((s,b) =>
        s + b.placements.reduce((q,p) => q+p.l*p.w*p.h,0),0);
      attempts.push({ ...result, variant, used, compact });
    }
    const complete = attempts.filter(a => a.index === data.cargos.length);
    const pool = complete.length ? complete : attempts;
    const best = pool.sort((a,b) =>
      complete.length ? a.used-b.used || a.compact-b.compact || a.nodes-b.nodes
                      : b.index-a.index || a.used-b.used || a.nodes-b.nodes)[0];
    const placed = new Set(best.bins.flatMap(b => b.placements.map(p => p.id)));
    const success = placed.size === data.cargos.length;
    const issues = validatePlan(data, best.bins);
    return {
      success: success && issues.length === 0,
      data,
      bins: best.bins,
      placed,
      unplaced: data.cargos.filter(c => !placed.has(c.id)),
      usedBins: best.bins.filter(b => b.placements.length).length,
      issues: issues.concat(success ? [] : diagnose(data, best.bins, placed)),
      attempts: attempts.map(a => ({ variant:a.variant, index:a.index, used:a.used, nodes:a.nodes }))
    };
  }

  function recommendExtraContainers(input, current) {
    if (current.success || !current.data.containers.length) return null;
    const unplacedCount = current.unplaced.length;
    const candidates = [...current.data.containers].sort((a,b) =>
      b.l*b.w*b.h*b.maxWeight - a.l*a.w*a.h*a.maxWeight);
    function distributions(total, index = 0) {
      if (index === candidates.length - 1) return [[total]];
      const result = [];
      for (let n = 0; n <= total; n++) {
        distributions(total - n, index + 1).forEach((tail) => result.push([n, ...tail]));
      }
      return result.filter(row => row.some(v => v > 0));
    }
    for (let n = 1; n <= unplacedCount; n++) {
      for (const row of distributions(n)) {
        const additions = candidates.map((spec, i) => ({ spec, count:row[i] })).filter(x => x.count);
        const trial = {
          ...input,
          containers: current.data.containers.map(b => {
            const add = additions.find(x => x.spec.id === b.id);
            return add ? { ...b, count:b.count+add.count } : b;
          }),
          supportRatio: current.data.supportRatio
        };
        const solved = plan(trial);
        if (solved.success) {
          const description = additions.map(x => `${x.count} 个「${x.spec.name}」`).join("、");
          return {
            count:n,
            additions,
            containerTypeId:additions[0]?.spec.id,
            containerName:additions[0]?.spec.name,
            message:`最少再增加 ${n} 个容器：${description}，即可容纳全部货物。`,
            previewBins:solved.bins.filter(b => b.placements.length)
          };
        }
      }
    }
    return {
      count:null,
      message:"即使为每种现有型号补充至每件货物一个容器，仍存在无法解除的硬冲突。",
      reasons:current.issues
    };
  }

  DP.validatePlan = validatePlan;
  DP.planLoading = plan;
  DP.recommendExtraContainers = recommendExtraContainers;
})();
