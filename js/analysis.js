(function (global) {
  "use strict";

  const DEFAULT_PARAMS = Object.freeze({
    clusterRadius: 50,
    minStayDuration: 300,
    companionRadius: 60,
    stableCompanionDuration: 300,
    maxTrackingGap: 180,
    driftSpeed: 55
  });

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function toRad(value) { return value * Math.PI / 180; }

  function validLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function haversine(a, b) {
    const R = 6371008.8;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function parseTime(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
    if (typeof value !== "string") return null;
    const ms = Date.parse(value.trim().replace(/\s+\d{4}$/, "").replace(" ", "T"));
    return Number.isFinite(ms) ? ms : null;
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) return "—";
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function addAnomaly(point, type, severity, message, details) {
    if (!point.anomalies.some(a => a.type === type)) {
      point.anomalies.push({ type, severity, message, details: details || {} });
    }
  }

  function stableKey(p, index) {
    return String(p._key || p.id || `row-${index}`);
  }

  function ensureRawPointKeys(points) {
    points.forEach((p, i) => {
      if (!p._key) p._key = `key-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    });
    return points;
  }

  function normalizeTarget(rawPoints, targetId, params) {
    const ordered = rawPoints
      .filter(p => String(p.targetId) === String(targetId))
      .map((p, index) => ({
        id: String(p.id), key: stableKey(p, index), targetId: String(targetId), time: parseTime(p.time),
        lat: Number(p.lat), lon: Number(p.lon), rawTime: p.time,
        rawLat: p.lat, rawLon: p.lon,
        originalOrder: Number.isFinite(Number(p.originalOrder)) ? Number(p.originalOrder) : index,
        anomalies: [], excluded: false, excludeReasons: [], canonical: false
      }))
      .sort((a, b) => a.originalOrder - b.originalOrder);

    const exactKeys = new Map(), timesSeen = new Map();
    let previousTime = null;
    for (const p of ordered) {
      if (!validLatLon(p.lat, p.lon)) {
        p.excluded = true; p.excludeReasons.push("invalid_coordinate");
        addAnomaly(p, "invalid_coordinate", "bad", "经纬度缺失或超出合法范围", { lat: p.rawLat, lon: p.rawLon });
      }
      if (p.time === null) {
        p.excluded = true; p.excludeReasons.push("invalid_time");
        addAnomaly(p, "invalid_time", "bad", "时刻无法解析", { time: p.rawTime });
      }
      if (p.time !== null) {
        if (previousTime !== null && p.time < previousTime) {
          addAnomaly(p, "out_of_order", "warn", "该点早于此前到达的点，推导时按时刻重排", { previousTime, currentTime: p.time });
        }
        previousTime = Math.max(previousTime ?? p.time, p.time);
      }
      if (p.time !== null && validLatLon(p.lat, p.lon)) {
        const key = `${p.time.toFixed(0)}|${p.lat.toFixed(7)}|${p.lon.toFixed(7)}`;
        if (exactKeys.has(key)) {
          const first = exactKeys.get(key);
          p.excluded = true; p.excludeReasons.push("duplicate");
          addAnomaly(p, "duplicate", "warn", "完全重复上报，保留并归并到首报", { duplicateOf: first.id });
        } else exactKeys.set(key, p);
        if (timesSeen.has(p.time)) {
          const first = timesSeen.get(p.time);
          p.excluded = true; p.excludeReasons.push("same_time_conflict");
          addAnomaly(p, "same_time_conflict", "bad", "同一目标同一时刻存在不同坐标；保留但不参与插值", { conflictsWith: first.id });
        } else timesSeen.set(p.time, p);
      }
    }

    const chronological = ordered
      .filter(p => p.time !== null && validLatLon(p.lat, p.lon) &&
        !p.excludeReasons.includes("duplicate") && !p.excludeReasons.includes("same_time_conflict"))
      .sort((a, b) => a.time - b.time || a.originalOrder - b.originalOrder);

    for (let i = 1; i < chronological.length - 1; i++) {
      const [a, p, b] = [chronological[i - 1], chronological[i], chronological[i + 1]];
      const dt1 = Math.max(1, (p.time - a.time) / 1000);
      const dt2 = Math.max(1, (b.time - p.time) / 1000);
      const dap = haversine(a, p), dpb = haversine(p, b), dab = haversine(a, b);
      if (dap / dt1 > params.driftSpeed && dpb / dt2 > params.driftSpeed &&
        dab < Math.max(100, params.clusterRadius * 3) &&
        dap > Math.max(dab * 3, params.clusterRadius * 2)) {
        p.excluded = true; p.excludeReasons.push("obvious_drift");
        addAnomaly(p, "obvious_drift", "bad", "明显漂移点：高速离开后返回，保留但不参与连续插值", {
          outboundMps: Math.round(dap / dt1 * 10) / 10,
          returnMps: Math.round(dpb / dt2 * 10) / 10, displacedM: Math.round(dap)
        });
      }
    }

    for (let i = 1; i < chronological.length; i++) {
      const a = chronological[i - 1], b = chronological[i];
      const speed = haversine(a, b) / Math.max(1, (b.time - a.time) / 1000);
      if (speed > params.driftSpeed) {
        for (const p of [a, b]) addAnomaly(p, "speed_gap", "warn", "相邻有效点速度过高，保留并提示复核", {
          edgeSpeedMps: Math.round(speed * 10) / 10, thresholdMps: params.driftSpeed
        });
      }
    }
    for (const p of ordered) p.canonical = !p.excluded;
    return { targetId: String(targetId), points: ordered };
  }

  function normalizePoints(rawPoints, params) {
    const ids = [...new Set(rawPoints.map(p => String(p.targetId)))].sort();
    return ids.flatMap(id => normalizeTarget(rawPoints, id, params).points);
  }

  function meanCenter(points) {
    const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const lon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
    return { lat, lon };
  }

  function clusterStats(points) {
    const center = meanCenter(points);
    let radius = 0;
    for (const p of points) radius = Math.max(radius, haversine(center, p));
    return { center, radius };
  }

  function extractStays(track, targetId, params) {
    const stays = [];
    let candidate = [];
    let active = null;

    const closeStay = points => {
      if (!points || points.length < 2) return;
      const duration = points[points.length - 1].time - points[0].time;
      if (duration < params.minStayDuration * 1000) return;
      const stats = clusterStats(points);
      stays.push({
        id: `${targetId}-S${stays.length + 1}`,
        kind: "stay", targetId: String(targetId),
        startTime: points[0].time, endTime: points[points.length - 1].time,
        startPointId: points[0].id, endPointId: points[points.length - 1].id,
        evidencePointIds: points.map(p => p.id),
        center: stats.center, radiusM: Math.round(stats.radius * 10) / 10,
        pointCount: points.length, durationSec: duration / 1000,
        params: { clusterRadius: params.clusterRadius, minStayDuration: params.minStayDuration },
        rationale: `${points.length} 个点在半径 ${params.clusterRadius}m 内聚集，持续 ${Math.round(duration / 1000)}s，达到最短 ${params.minStayDuration}s`
      });
    };

    for (const p of track) {
      const trial = (active ? active.points : candidate).concat(p);
      const fits = clusterStats(trial).radius <= params.clusterRadius;
      if (fits) {
        if (active) active.points = trial;
        else {
          candidate = trial;
          const duration = candidate.at(-1).time - candidate[0].time;
          if (candidate.length >= 2 && duration >= params.minStayDuration * 1000) {
            active = { points: candidate };
          }
        }
      } else if (active) {
        closeStay(active.points);
        active = null;
        candidate = [p];
      } else {
        candidate = [p];
      }
    }
    if (active) closeStay(active.points);
    return stays;
  }

  function makeMove(points, targetId, index, params) {
    if (!points || points.length < 2) return null;
    const start = points[0], end = points[points.length - 1];
    if (end.time <= start.time) return null;
    const durationSec = (end.time - start.time) / 1000;
    const distance = points.slice(1).reduce((sum, p, i) => sum + haversine(points[i], p), 0);
    return {
      id: `${targetId}-M${index}`, kind: "move", targetId: String(targetId),
      startTime: start.time, endTime: end.time,
      startPointId: start.id, endPointId: end.id,
      evidencePointIds: points.map(p => p.id),
      distanceM: Math.round(distance * 10) / 10,
      durationSec, meanSpeedMps: Math.round(distance / durationSec * 100) / 100,
      pointCount: points.length,
      params: { clusterRadius: params.clusterRadius, minStayDuration: params.minStayDuration },
      rationale: `未达到停留条件的连续轨迹，路径约 ${Math.round(distance)}m，平均速度 ${(distance / durationSec).toFixed(2)}m/s`
    };
  }

  function deriveTarget(points, targetId, params) {
    const track = points
      .filter(p => String(p.targetId) === String(targetId) && p.canonical)
      .sort((a, b) => a.time - b.time || a.originalOrder - b.originalOrder);
    const stays = extractStays(track, targetId, params);
    const moves = [];
    const byId = new Map(track.map(p => [p.id, p]));
    let cursor = 0;
    const addMove = (startId, endId) => {
      const si = track.findIndex((p, i) => i >= cursor && p.id === startId);
      const ei = track.findIndex((p, i) => i >= si && p.id === endId);
      if (si >= 0 && ei > si) {
        const move = makeMove(track.slice(si, ei + 1), targetId, moves.length + 1, params);
        if (move) moves.push(move);
      }
      return ei;
    };
    for (let i = 0; i < stays.length; i++) {
      const stay = stays[i];
      if (i === 0 && track[0].id !== stay.startPointId) cursor = addMove(track[0].id, stay.startPointId) + 1 || cursor;
      if (i > 0) {
        const prevEnd = byId.get(stays[i - 1].endPointId);
        const nextStart = byId.get(stay.startPointId);
        if (prevEnd && nextStart && track.indexOf(nextStart) > track.indexOf(prevEnd)) {
          cursor = addMove(stays[i - 1].endPointId, stay.startPointId);
        }
      }
    }
    const last = stays[stays.length - 1];
    if (last && last.endPointId !== track.at(-1).id) addMove(last.endPointId, track.at(-1).id);
    if (!stays.length) {
      const move = makeMove(track, targetId, 1, params);
      if (move) moves.push(move);
    }
    const segments = [...stays, ...moves].sort((a, b) => a.startTime - b.startTime);
    return { targetId: String(targetId), stays, moves, segments, canonicalPointIds: track.map(p => p.id) };
  }

  function positionAt(track, t, maxGapSec) {
    let lo = 0, hi = track.length - 1;
    if (t < track[lo].time || t > track[hi].time) return null;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (track[mid].time <= t) lo = mid; else hi = mid - 1;
    }
    const a = track[lo], b = track[lo + 1] || a;
    if (t === a.time) return { lat: a.lat, lon: a.lon, pointIds: [a.id], interpolated: false };
    if (!track[lo + 1]) return null;
    const gapSec = (b.time - a.time) / 1000;
    if (gapSec > maxGapSec) return null;
    const ratio = (t - a.time) / (b.time - a.time);
    return {
      lat: a.lat + (b.lat - a.lat) * ratio,
      lon: a.lon + (b.lon - a.lon) * ratio,
      pointIds: [a.id, b.id], interpolated: true
    };
  }

  function pairSamples(trackA, trackB, params) {
    const start = Math.max(trackA[0].time, trackB[0].time);
    const end = Math.min(trackA.at(-1).time, trackB.at(-1).time);
    if (end <= start) return [];
    const times = [...new Set(trackA.concat(trackB).map(p => p.time))]
      .filter(t => t >= start && t <= end).sort((a, b) => a - b);
    return times.map(t => {
      const a = positionAt(trackA, t, params.maxTrackingGap);
      const b = positionAt(trackB, t, params.maxTrackingGap);
      if (!a || !b) return { time: t, available: false };
      return { time: t, available: true, distance: haversine(a, b), a, b };
    });
  }

  function buildRelation(pair, samples, runIndexes, index, params) {
    const run = runIndexes.map(i => samples[i]);
    const start = run[0].time, end = run.at(-1).time;
    const durationSec = (end - start) / 1000;
    const distances = run.map(s => s.distance);
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const pointIds = new Set();
    let directSamples = 0;
    for (const s of run) {
      if (!s.a.interpolated || !s.b.interpolated) directSamples++;
      s.a.pointIds.concat(s.b.pointIds).forEach(id => pointIds.add(id));
    }
    const eventTimes = new Set(pair.trackA.concat(pair.trackB)
      .filter(p => p.time >= start && p.time <= end).map(p => p.time));
    const supportRate = Math.min(1, directSamples / Math.max(1, eventTimes.size));
    const gaps = run.slice(1).map((s, i) => (s.time - run[i].time) / 1000);
    const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : params.maxTrackingGap;
    const cadence = Math.max(0, Math.min(1, 30 / Math.max(1, medianGap)));
    const coverage = Math.max(0, 1 - avgDistance / params.companionRadius);
    const durationScore = Math.min(1, durationSec / params.stableCompanionDuration);
    const stable = durationSec >= params.stableCompanionDuration;
    const confidence = Math.round(100 * (0.2 * supportRate + 0.2 * cadence + 0.2 * coverage +
      0.2 * (stable ? 1 : durationScore) + 0.2 * Math.min(1, run.length / Math.max(2, eventTimes.size))));
    return {
      id: `${pair.id}-R${index}`, pairKey: pair.id,
      targetIds: [pair.a, pair.b], kind: "companion",
      relation: stable ? "stable" : "casual",
      startTime: start, endTime: end, durationSec,
      avgDistanceM: Math.round(avgDistance * 10) / 10,
      maxDistanceM: Math.round(maxDistance * 10) / 10,
      sampleCount: run.length, directSamples,
      confidence: Math.max(1, Math.min(99, confidence)),
      evidencePointIds: [...pointIds],
      sampleEvidence: run.map(s => ({
        time: s.time, distanceM: Math.round(s.distance * 10) / 10,
        pointIds: s.a.pointIds.concat(s.b.pointIds)
      })),
      params: {
        companionRadius: params.companionRadius,
        stableCompanionDuration: params.stableCompanionDuration,
        maxTrackingGap: params.maxTrackingGap
      },
      rationale: `${stable ? "稳定同行" : "偶发接近"}：${run.length} 个共同观测点连续 ${Math.round(durationSec)}s 在 ${params.companionRadius}m 内，平均 ${Math.round(avgDistance)}m，置信度 ${confidence}%`
    };
  }

  function analyzePairRelations(tracks, a, b, params) {
    const trackA = tracks.get(a), trackB = tracks.get(b);
    if (!trackA || !trackB || trackA.length < 2 || trackB.length < 2) return [];
    const samples = pairSamples(trackA, trackB, params);
    const relations = [];
    let run = [];
    const pair = { id: [a, b].sort().join("↔"), a, b, trackA, trackB };
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const contiguous = !run.length ||
        (s.available && (s.time - samples[run[run.length - 1]].time) / 1000 <= params.maxTrackingGap);
      if (!s.available || s.distance > params.companionRadius || !contiguous) {
        if (run.length > 1) relations.push(buildRelation(pair, samples, run, relations.length + 1, params));
        run = [];
      } else {
        run.push(i);
      }
    }
    if (run.length > 1) relations.push(buildRelation(pair, samples, run, relations.length + 1, params));
    return relations;
  }

  function componentsFromRelations(activeRelations) {
    const parent = new Map();
    const find = x => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
      return parent.get(x);
    };
    const union = (a, b) => parent.set(find(a), find(b));
    for (const rel of activeRelations) rel.targetIds.forEach(t => find(t));
    for (const rel of activeRelations) union(rel.targetIds[0], rel.targetIds[1]);
    const groups = new Map();
    for (const t of parent.keys()) {
      const root = find(t);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root).add(t);
    }
    return [...groups.values()]
      .filter(set => set.size >= 2)
      .map(set => [...set].sort().join("↔"));
  }

  function buildCompanionGroups(relations) {
    const stable = relations.filter(r => r.relation === "stable");
    const events = stable.flatMap(r => [
      { time: r.startTime, type: "start", rel: r },
      { time: r.endTime, type: "end", rel: r }
    ]).sort((a, b) => a.time - b.time);
    const active = new Map();
    let current = new Map();
    const completed = [];

    for (let i = 0; i < events.length;) {
      const time = events[i].time;
      const batch = [];
      while (i < events.length && events[i].time === time) batch.push(events[i++]);
      for (const event of batch) {
        if (event.type === "end") active.delete(event.rel.id);
      }
      for (const event of batch) {
        if (event.type === "start") active.set(event.rel.id, event.rel);
      }
      const nextKeys = new Set(componentsFromRelations([...active.values()]));
      for (const [key, group] of current) {
        if (!nextKeys.has(key)) {
          group.endTime = time;
          if (group.endTime > group.startTime) completed.push(group);
        }
      }
      const next = new Map();
      for (const key of nextKeys) {
        const existing = current.get(key);
        next.set(key, existing || {
          groupKey: key, targets: key.split("↔"),
          startTime: time, relationIds: []
        });
      }
      current = next;
    }
    for (const group of current.values()) completed.push(group);
    const groups = completed.sort((a, b) => a.startTime - b.startTime).map((g, i) => {
      const related = stable.filter(r => r.startTime < g.endTime && r.endTime > g.startTime &&
        g.targets.includes(r.targetIds[0]) && g.targets.includes(r.targetIds[1]));
      related.forEach(r => { r.groupId = `G${i + 1}`; });
      return {
        id: `G${i + 1}`, kind: "group", targetIds: g.targets,
        startTime: g.startTime, endTime: g.endTime,
        durationSec: (g.endTime - g.startTime) / 1000,
        relationIds: related.map(r => r.id),
        rationale: `${g.targets.join("、")} 在该区间由稳定同行边连通，构成 ${g.targets.length} 人同行群体`
      };
    });
    return groups;
  }

  function analyzeAll(rawPoints, params) {
    const p = Object.assign({}, DEFAULT_PARAMS, params || {});
    const points = normalizePoints(rawPoints, p);
    const targetIds = [...new Set(points.map(x => x.targetId))].sort();
    const targets = targetIds.map(id => deriveTarget(points, id, p));
    const tracks = new Map(targetIds.map(id => [
      id,
      points.filter(x => x.targetId === id && x.canonical)
        .sort((a, b) => a.time - b.time || a.originalOrder - b.originalOrder)
    ]));
    let relations = [];
    for (let i = 0; i < targetIds.length; i++) {
      for (let j = i + 1; j < targetIds.length; j++) {
        relations = relations.concat(analyzePairRelations(tracks, targetIds[i], targetIds[j], p));
      }
    }
    const groups = buildCompanionGroups(relations);
    return { params: p, points, targets, relations, groups, targetIds, tracks };
  }

  function relationSignature(rel) {
    return rel.targetIds.slice().sort().join("↔") + "|" + rel.relation;
  }

  function diffRelations(before, after) {
    const oldLeft = new Map(before.map(r => [r.id, r]));
    const newLeft = new Map(after.map(r => [r.id, r]));
    const pairs = new Map();
    const add = (map, rel) => {
      const key = relationSignature(rel);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rel);
    };
    for (const r of before) add(pairs, r);
    const candidates = [];
    for (const nr of after) {
      for (const or of pairs.get(relationSignature(nr)) || []) {
        const overlap = Math.max(0, Math.min(nr.endTime, or.endTime) - Math.max(nr.startTime, or.startTime));
        const gap = overlap > 0 ? 0 : Math.min(Math.abs(nr.startTime - or.startTime), Math.abs(nr.endTime - or.endTime));
        candidates.push({ score: overlap - gap, nr, or });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.nr.startTime - b.nr.startTime || a.nr.id.localeCompare(b.nr.id));
    const matches = new Map();
    for (const c of candidates) {
      if (oldLeft.has(c.or.id) && newLeft.has(c.nr.id)) {
        matches.set(c.or.id, c.nr);
        oldLeft.delete(c.or.id);
        newLeft.delete(c.nr.id);
      }
    }
    const changes = [];
    for (const [oldId, nr] of matches) {
      const or = before.find(r => r.id === oldId);
      const details = [];
      if (or.relation !== nr.relation) details.push("type");
      if (or.startTime !== nr.startTime) details.push("startTime");
      if (or.endTime !== nr.endTime) details.push("endTime");
      if (Math.abs(or.confidence - nr.confidence) >= 1) details.push("confidence");
      if (details.length) changes.push({ kind: "changed", before: or, after: nr, details });
    }
    for (const r of oldLeft.values()) changes.push({ kind: "removed", before: r });
    for (const r of newLeft.values()) changes.push({ kind: "added", after: r });
    return changes.sort((a, b) => (a.after || a.before).startTime - (b.after || b.before).startTime);
  }

  function createState(rawPoints, params) {
    const owned = ensureRawPointKeys(clone(rawPoints));
    const analysis = analyzeAll(owned, params);
    return {
      rawPoints: owned, analysis,
      previousRelations: clone(analysis.relations), relationChanges: [],
      lastAffected: { targetIds: analysis.targetIds.slice(), pairKeys: [], reason: "initial" }
    };
  }

  function recomputeState(state, affectedTargetIds, reason) {
    const p = state.analysis.params;
    const previous = clone(state.analysis.relations);
    const affected = new Set(affectedTargetIds.map(String));
    const allIds = [...new Set(state.rawPoints.map(x => String(x.targetId)))].sort();
    const normalized = [];
    for (const id of allIds) {
      normalized.push(...(affected.has(id)
        ? normalizeTarget(state.rawPoints, id, p).points
        : state.analysis.points.filter(x => x.targetId === id)));
    }
    const targetMap = new Map(state.analysis.targets.map(t => [t.targetId, t]));
    for (const id of affected) {
      if (!allIds.includes(id)) targetMap.delete(id);
      else targetMap.set(id, deriveTarget(normalized, id, p));
    }
    const targets = allIds.map(id => targetMap.get(id)).filter(Boolean);
    const tracks = new Map(allIds.map(id => [
      id,
      normalized.filter(x => x.targetId === id && x.canonical)
        .sort((a, b) => a.time - b.time || a.originalOrder - b.originalOrder)
    ]));
    const pairKeys = new Set();
    for (const id of affected) {
      for (const other of allIds) {
        if (other !== id) pairKeys.add([id, other].sort().join("↔"));
      }
    }
    const kept = state.analysis.relations.filter(r => !pairKeys.has(r.targetIds.slice().sort().join("↔")));
    let fresh = [];
    for (const key of pairKeys) {
      const [a, b] = key.split("↔");
      fresh = fresh.concat(analyzePairRelations(tracks, a, b, p));
    }
    const relations = kept.concat(fresh).sort((a, b) => a.startTime - b.startTime || a.pairKey.localeCompare(b.pairKey));
    const groups = buildCompanionGroups(relations);
    state.analysis = { params: p, points: normalized, targets, relations, groups, targetIds: allIds, tracks };
    state.relationChanges = diffRelations(previous, relations);
    state.previousRelations = clone(relations);
    state.lastAffected = { targetIds: [...affected], pairKeys: [...pairKeys], reason };
    return state;
  }

  function updatePoints(state, nextRawPoints, changedPoint) {
    state.rawPoints = ensureRawPointKeys(clone(nextRawPoints));
    const affected = changedPoint?.targetId ? [String(changedPoint.targetId)] :
      [...new Set(nextRawPoints.map(p => String(p.targetId)))];
    if (changedPoint?.oldTargetId && !affected.includes(String(changedPoint.oldTargetId))) {
      affected.push(String(changedPoint.oldTargetId));
    }
    return recomputeState(state, affected, changedPoint ? "point_edit" : "points_replaced");
  }

  function updateParams(state, nextParams, scope) {
    const p = Object.assign({}, state.analysis.params, nextParams);
    const ids = state.analysis.targetIds;
    const normalizedChanged = scope.normalizedParams === true;
    const targetParamsAffected = scope.targetParams === true;
    const companionParamsAffected = scope.companionParams === true;
    if (normalizedChanged) {
      const next = createState(state.rawPoints, p);
      next.relationChanges = diffRelations(state.analysis.relations, next.analysis.relations);
      next.lastAffected = {
        targetIds: ids.slice(),
        pairKeys: ids.flatMap((a, i) => ids.slice(i + 1).map(b => [a, b].sort().join("↔"))),
        reason: "parameter_change"
      };
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, next);
      return state;
    }
    const previous = clone(state.analysis.relations);
    const points = state.analysis.points;
    const targets = targetParamsAffected
      ? ids.map(id => deriveTarget(points, id, p))
      : state.analysis.targets;
    const tracks = state.analysis.tracks;
    let relations = state.analysis.relations;
    if (companionParamsAffected) {
      relations = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          relations = relations.concat(analyzePairRelations(tracks, ids[i], ids[j], p));
        }
      }
    }
    state.analysis.params = p;
    state.analysis.targets = targets;
    state.analysis.relations = relations;
    state.analysis.groups = buildCompanionGroups(relations);
    state.relationChanges = diffRelations(previous, relations);
    state.previousRelations = clone(relations);
    state.lastAffected = {
      targetIds: targetParamsAffected ? ids.slice() : [],
      pairKeys: companionParamsAffected
        ? ids.flatMap((a, i) => ids.slice(i + 1).map(b => [a, b].sort().join("↔"))) : [],
      reason: "parameter_change"
    };
    return state;
  }

  global.MovementAnalysisCore = {
    DEFAULT_PARAMS, clone, haversine, validLatLon, parseTime, formatTime,
    addAnomaly, normalizeTarget, normalizePoints, deriveTarget, analyzeAll,
    diffRelations, createState, recomputeState, updatePoints, updateParams
  };
})(typeof window !== "undefined" ? window : globalThis);
