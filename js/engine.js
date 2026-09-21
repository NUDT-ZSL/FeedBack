/*
 * 区域仓网缺口识别与调拨最小费用流引擎
 * 纯浏览器/Node 均可运行，不依赖第三方库。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AllocationEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    horizonDays: 7,
    distanceCostPerUnitKm: 0.6,
    timeCostPerUnitDay: 3,
    costScale: 1000
  };

  function toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonNegative(value) {
    return Math.max(0, toFiniteNumber(value, 0));
  }

  function integer(value) {
    return Math.round(nonNegative(value));
  }

  function normalizeLocation(raw) {
    return {
      id: String(raw.id || raw.name || ""),
      name: String(raw.name || raw.id || "未命名地点"),
      stock: integer(raw.stock),
      inbound: integer(raw.inbound),
      safety: integer(raw.safety),
      demand: integer(raw.demand)
    };
  }

  function normalizeLane(raw, locationsById) {
    const from = String(raw.from);
    const to = String(raw.to);
    const fromName = locationsById.get(from)?.name || from;
    const toName = locationsById.get(to)?.name || to;
    return {
      from,
      to,
      name: raw.name ? String(raw.name) : `${fromName} → ${toName}`,
      distanceKm: nonNegative(raw.distanceKm),
      unitFreight: nonNegative(raw.unitFreight),
      leadTimeDays: nonNegative(raw.leadTimeDays)
    };
  }

  function locationState(location) {
    const available = location.stock + location.inbound;
    const target = location.demand + location.safety;
    const gap = Math.max(0, target - available);
    const surplus = Math.max(0, available - target);
    const actualShortage = Math.max(0, location.demand - available);
    const safetyShortage = Math.max(
      0,
      Math.min(gap, location.safety - Math.max(0, available - location.demand))
    );
    let status = "balanced";
    if (actualShortage > 0) status = "stockout";
    else if (gap > 0) status = "safety";
    else if (surplus > 0) status = "surplus";
    return {
      ...location,
      available,
      target,
      gap,
      surplus,
      actualShortage,
      safetyShortage,
      status
    };
  }

  function priorityLocations(states) {
    const deficient = states.filter((s) => s.gap > 0);
    return deficient
      .map((s) => {
        const demandRatio =
          s.demand > 0 ? s.actualShortage / s.demand : s.actualShortage > 0 ? 1 : 0;
        const safetyRatio =
          s.safety > 0 ? s.safetyShortage / s.safety : s.safetyShortage > 0 ? 1 : 0;
        return {
          id: s.id,
          tier: s.actualShortage > 0 ? 1 : 2,
          demandRatio,
          safetyRatio,
          ratio: s.actualShortage > 0 ? demandRatio : safetyRatio,
          basis:
            s.actualShortage > 0
              ? `P1 实际缺货 ${s.actualShortage} 件，缺货率 ${(demandRatio * 100).toFixed(1)}%`
              : `P2 低于安全库存 ${s.safetyShortage} 件，安全库存缺口率 ${(safetyRatio * 100).toFixed(1)}%`
        };
      })
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (b.ratio !== a.ratio) return b.ratio - a.ratio;
        const ag = states.find((s) => s.id === a.id).gap;
        const bg = states.find((s) => s.id === b.id).gap;
        if (bg !== ag) return bg - ag;
        return a.id.localeCompare(b.id, "zh-Hans-CN");
      })
      .map((p, index) => ({ ...p, priorityRank: index + 1 }));
  }

  function laneUnitCost(lane, settings) {
    const freight = lane.unitFreight;
    const distanceCost = lane.distanceKm * settings.distanceCostPerUnitKm;
    const timeCost = lane.leadTimeDays * settings.timeCostPerUnitDay;
    return {
      freight,
      distanceCost,
      timeCost,
      total: freight + distanceCost + timeCost
    };
  }

  function addEdge(graph, from, to, capacity, cost, specIndex) {
    graph[from].push({
      from,
      to,
      capacity,
      cost,
      reverse: graph[to].length,
      specIndex
    });
    graph[to].push({
      from: to,
      to: from,
      capacity: 0,
      cost: -cost,
      reverse: graph[from].length - 1,
      specIndex: -1
    });
  }

  function minCostFlow(edgeSpecs, requiredFlow, costScale) {
    const nodeIds = new Set();
    edgeSpecs.forEach((edge) => {
      nodeIds.add(edge.from).add(edge.to);
    });
    const nodes = Array.from(nodeIds);
    const index = new Map(nodes.map((id, i) => [id, i]));
    const graph = nodes.map(() => []);
    edgeSpecs.forEach((edge, specIndex) => {
      if (edge.capacity > 0) {
        addEdge(graph, index.get(edge.from), index.get(edge.to), edge.capacity, edge.cost, specIndex);
      }
    });

    const source = index.get("source");
    const sink = index.get("sink");
    let flow = 0;
    let scaledCost = 0;
    const flows = [];

    while (flow < requiredFlow) {
      const size = nodes.length;
      const dist = Array(size).fill(Infinity);
      const previousNode = Array(size).fill(-1);
      const previousEdge = Array(size).fill(-1);
      const inQueue = Array(size).fill(false);
      const queue = [source];
      dist[source] = 0;

      while (queue.length) {
        const u = queue.shift();
        inQueue[u] = false;
        graph[u].forEach((edge, edgeIndex) => {
          if (edge.capacity <= 0) return;
          const v = edge.to;
          const candidate = dist[u] + edge.cost;
          if (candidate < dist[v] - 1e-9) {
            dist[v] = candidate;
            previousNode[v] = u;
            previousEdge[v] = edgeIndex;
            if (!inQueue[v]) {
              queue.push(v);
              inQueue[v] = true;
            }
          }
        });
      }

      if (!Number.isFinite(dist[sink])) break;

      let pushAmount = requiredFlow - flow;
      for (let v = sink; v !== source; v = previousNode[v]) {
        const edge = graph[previousNode[v]][previousEdge[v]];
        pushAmount = Math.min(pushAmount, edge.capacity);
      }
      for (let v = sink; v !== source; v = previousNode[v]) {
        const u = previousNode[v];
        const edgeIndex = previousEdge[v];
        const edge = graph[u][edgeIndex];
        edge.capacity -= pushAmount;
        graph[v][edge.reverse].capacity += pushAmount;
        scaledCost += pushAmount * edge.cost;
      }
      flow += pushAmount;
    }

    edgeSpecs.forEach((spec, specIndex) => {
      const u = index.get(spec.from);
      const v = index.get(spec.to);
      const edge = graph[u].find((e) => e.specIndex === specIndex);
      if (edge) {
        flows[specIndex] = spec.capacity > 0 ? Math.max(0, spec.capacity - edge.capacity) : 0;
      }
    });

    return { flow, scaledCost, flows };
  }

  function normalizeSettings(rawSettings) {
    const settings = { ...DEFAULTS, ...(rawSettings || {}) };
    return {
      horizonDays: integer(settings.horizonDays) || 1,
      distanceCostPerUnitKm: Math.max(0, toFiniteNumber(settings.distanceCostPerUnitKm, 0.6)),
      timeCostPerUnitDay: Math.max(0, toFiniteNumber(settings.timeCostPerUnitDay, 3)),
      costScale: Math.max(100, integer(settings.costScale) || DEFAULTS.costScale)
    };
  }

  function createPlan(input) {
    const settings = normalizeSettings(input.settings);
    const seen = new Set();
    const locations = (input.locations || [])
      .map(normalizeLocation)
      .filter((location) => {
        if (!location.id || seen.has(location.id)) return false;
        seen.add(location.id);
        return true;
      });
    const locationsById = new Map(locations.map((location) => [location.id, location]));
    const rawLanes = input.lanes || [];
    const lanes = rawLanes
      .map((lane) => normalizeLane(lane, locationsById))
      .filter((lane) => {
        if (!locationsById.has(lane.from) || !locationsById.has(lane.to)) return false;
        return lane.from !== lane.to;
      });

    const states = locations.map(locationState);
    const stateById = new Map(states.map((state) => [state.id, state]));
    const priorities = priorityLocations(states);
    const priorityById = new Map(priorities.map((item) => [item.id, item]));
    const deficient = states.filter((state) => state.gap > 0);
    const suppliers = states.filter((state) => state.surplus > 0);
    const totalGap = deficient.reduce((sum, state) => sum + state.gap, 0);
    const totalSurplus = suppliers.reduce((sum, state) => sum + state.surplus, 0);

    const laneView = lanes.map((lane) => ({
      ...lane,
      ...laneUnitCost(lane, settings),
      overHorizon: lane.leadTimeDays > settings.horizonDays
    }));
    const laneKey = new Map(laneView.map((lane) => [`${lane.from}->${lane.to}`, lane]));
    const maxLaneCost = laneView.reduce((max, lane) => Math.max(max, lane.total), 0);
    const priorityWeightUnit = maxLaneCost + 1;

    const edgeSpecs = [];
    suppliers.forEach((supplier) => {
      edgeSpecs.push({
        kind: "supply",
        from: "source",
        to: `supply:${supplier.id}`,
        capacity: supplier.surplus,
        cost: 0
      });
    });

    const laneEdges = [];
    suppliers.forEach((supplier) => {
      deficient.forEach((demandLocation) => {
        const lane = laneKey.get(`${supplier.id}->${demandLocation.id}`);
        if (!lane) return;
        const edge = {
          kind: "lane",
          lane,
          from: `supply:${supplier.id}`,
          to: `demand:${demandLocation.id}`,
          capacity: Math.min(supplier.surplus, demandLocation.gap),
          cost: Math.round(lane.total * settings.costScale)
        };
        laneEdges.push(edge);
        edgeSpecs.push(edge);
      });
    });

    deficient.forEach((demandLocation) => {
      const priority = priorityById.get(demandLocation.id);
      const rankFromZero = priority.priorityRank - 1;
      const rankPenalty = rankFromZero * priorityWeightUnit * settings.costScale;
      edgeSpecs.push({
        kind: "demand",
        from: `demand:${demandLocation.id}`,
        to: "sink",
        capacity: demandLocation.gap,
        cost: rankPenalty
      });
    });

    const requiredFlow = Math.min(totalGap, totalSurplus);
    const flowResult =
      requiredFlow > 0
        ? minCostFlow(edgeSpecs, requiredFlow, settings.costScale)
        : { flow: 0, scaledCost: 0, flows: edgeSpecs.map(() => 0) };

    const shipments = [];
    laneEdges.forEach((edge, index) => {
      const quantity = flowResult.flows[edgeSpecs.indexOf(edge)] || 0;
      if (quantity <= 0) return;
      const lane = edge.lane;
      const freightCost = quantity * lane.freight;
      const distanceCost = quantity * lane.distanceCost;
      const timeCost = quantity * lane.timeCost;
      shipments.push({
        from: lane.from,
        to: lane.to,
        fromName: stateById.get(lane.from).name,
        toName: stateById.get(lane.to).name,
        quantity,
        distanceKm: lane.distanceKm,
        unitFreight: lane.unitFreight,
        leadTimeDays: lane.leadTimeDays,
        freightCost,
        distanceCost,
        transportCost: freightCost + distanceCost,
        timeCost,
        totalCost: freightCost + distanceCost + timeCost,
        overHorizon: lane.overHorizon
      });
    });

    shipments.sort((a, b) => {
      const pa = priorityById.get(a.to)?.priorityRank || 999;
      const pb = priorityById.get(b.to)?.priorityRank || 999;
      if (pa !== pb) return pa - pb;
      return b.totalCost - a.totalCost;
    });

    const inboundByDestination = new Map();
    const outboundBySource = new Map();
    shipments.forEach((shipment) => {
      inboundByDestination.set(shipment.to, (inboundByDestination.get(shipment.to) || 0) + shipment.quantity);
      outboundBySource.set(shipment.from, (outboundBySource.get(shipment.from) || 0) + shipment.quantity);
    });

    const locationResults = states.map((state) => {
      const inboundQuantity = inboundByDestination.get(state.id) || 0;
      const outboundQuantity = outboundBySource.get(state.id) || 0;
      const remainingGap = Math.max(0, state.gap - inboundQuantity);
      const priority = priorityById.get(state.id);
      const supporters = laneView
        .filter((lane) => lane.to === state.id)
        .map((lane) => {
          const source = stateById.get(lane.from);
          return {
            id: lane.from,
            name: source.name,
            availableSurplus: source.surplus,
            distanceKm: lane.distanceKm,
            unitFreight: lane.unitFreight,
            leadTimeDays: lane.leadTimeDays,
            unitTotalCost: lane.total
          };
        })
        .sort((a, b) => a.unitTotalCost - b.unitTotalCost);

      let recommendation = "无需调拨";
      if (state.gap > 0) {
        if (inboundQuantity >= state.gap) recommendation = `建议调入 ${inboundQuantity} 件，缺口已消解`;
        else if (inboundQuantity > 0) recommendation = `仅可调入 ${inboundQuantity} 件，仍缺 ${remainingGap} 件`;
        else if (supporters.length === 0) recommendation = "存在缺口，但未配置有效支援路径";
        else recommendation = "存在缺口，但当前网络无可分配余量";
      } else if (outboundQuantity > 0) {
        recommendation = `建议调出 ${outboundQuantity} 件，保留安全库存后仍有 ${state.surplus - outboundQuantity} 件余量`;
      }

      return {
        ...state,
        priorityRank: priority?.priorityRank || null,
        priorityTier: priority?.tier || null,
        inboundQuantity,
        outboundQuantity,
        remainingGap,
        supporters,
        recommendation
      };
    });

    const resultById = new Map(locationResults.map((item) => [item.id, item]));
    const sumOf = (list, key) => list.reduce((sum, item) => sum + item[key], 0);
    const totalFreightCost = sumOf(shipments, "freightCost");
    const totalDistanceCost = sumOf(shipments, "distanceCost");
    const totalTransportCost = sumOf(shipments, "transportCost");
    const totalTimeCost = sumOf(shipments, "timeCost");
    const totalCost = sumOf(shipments, "totalCost");
    const fulfilledGap = sumOf(shipments, "quantity");
    const unresolvedGap = totalGap - fulfilledGap;
    const balanced = unresolvedGap === 0;

    const priorityExplanations = priorities.map((priority) => {
      const result = resultById.get(priority.id);
      return {
        id: priority.id,
        name: result.name,
        priorityRank: priority.priorityRank,
        tier: priority.tier,
        basis: priority.basis,
        gap: result.gap,
        allocated: result.inboundQuantity,
        remainingGap: result.remainingGap,
        reason:
          result.remainingGap === 0
            ? "已按当前最低综合代价路径满足。"
            : result.supporters.length === 0
              ? "未配置可到达该地点的调拨线路，因此无法分配。"
              : "高优先级已先行分配；全局可调出余量或线路容量不足，剩余缺口需补货或扩容。"
      };
    });

    const warnings = [];
    if (!balanced) {
      warnings.push(
        totalSurplus < totalGap
          ? `全局无法完全平衡：总缺口 ${totalGap} 件，安全库存外可调出余量仅 ${totalSurplus} 件，尚缺 ${unresolvedGap} 件。`
          : `全局余量看似充足，但受现有调拨线路连通性限制，仍有 ${unresolvedGap} 件缺口无法消解。`
      );
    }
    const noRouteLocations = locationResults.filter((item) => item.gap > 0 && item.supporters.length === 0);
    if (noRouteLocations.length) {
      warnings.push(`${noRouteLocations.map((item) => item.name).join("、")} 没有配置任何有效支援线路。`);
    }
    if (shipments.some((item) => item.overHorizon)) {
      warnings.push(`部分建议线路超过 ${settings.horizonDays} 天计划窗口；系统已将时效折算为代价，但仍建议关注到货风险。`);
    }

    return {
      generatedAt: new Date().toISOString(),
      settings,
      locations,
      lanes: laneView,
      locationResults,
      priorities,
      priorityExplanations,
      shipments,
      summary: {
        locationCount: locations.length,
        deficientCount: deficient.length,
        supplierCount: suppliers.length,
        totalGap,
        totalSurplus,
        fulfilledGap,
        unresolvedGap,
        totalFreightCost,
        totalDistanceCost,
        totalTransportCost,
        totalTimeCost,
        totalCost,
        balanced
      },
      warnings
    };
  }

  return {
    DEFAULTS,
    normalizeSettings,
    normalizeLocation,
    normalizeLane,
    locationState,
    priorityLocations,
    laneUnitCost,
    minCostFlow,
    createPlan
  };
});
