/* 地理围栏推演引擎：纯函数实现，无 DOM 依赖，可在浏览器与 Node 中复用。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GeoEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const EARTH_R = 6371000; // 地球半径（米）

  function haversineM(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // 射线法判断点是否在多边形内，poly 为 [[lat,lng],...]
  function pointInPolygon(lat, lng, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1];
      const yj = poly[j][0], xj = poly[j][1];
      if (((xi > lng) !== (xj > lng)) &&
          (lat < (yj - yi) * (lng - xi) / (xj - xi) + yi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // 解析单个轨迹点，支持 {time,lat,lng} 或 [time,lat,lng]
  function parsePoint(raw) {
    let time, lat, lng;
    if (Array.isArray(raw)) {
      time = raw[0]; lat = raw[1]; lng = raw[2];
    } else if (raw && typeof raw === 'object') {
      time = raw.time != null ? raw.time : raw.t;
      lat = raw.lat != null ? raw.lat : raw.latitude;
      lng = raw.lng != null ? raw.lng : (raw.lon != null ? raw.lon : raw.longitude);
    } else {
      return { ok: false, reason: '记录不是对象或数组' };
    }
    if (time == null || time === '') return { ok: false, reason: '缺少时间戳' };
    const t = (time instanceof Date) ? time.getTime() : new Date(time).getTime();
    if (!Number.isFinite(t)) return { ok: false, reason: '时间戳无法解析: ' + String(time) };
    lat = Number(lat); lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, reason: '坐标不是有效数字' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, reason: '坐标超出合法范围(lat=' + lat + ',lng=' + lng + ')' };
    }
    return { ok: true, point: { t: t, lat: lat, lng: lng } };
  }

  // 归一化轨迹：跳过无效点并按时间升序排序
  function normalizePoints(rawPoints) {
    const points = [];
    const skipped = [];
    (rawPoints || []).forEach(function (raw, i) {
      const r = parsePoint(raw);
      if (r.ok) points.push(r.point);
      else skipped.push({ index: i, raw: raw, reason: r.reason });
    });
    points.sort(function (a, b) { return a.t - b.t; });
    return { points: points, skipped: skipped };
  }

  function speedKmh(a, b) {
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    return haversineM(a.lat, a.lng, b.lat, b.lng) / dt * 3.6;
  }

  function fmtTime(t) {
    return new Date(t).toISOString().substr(11, 8);
  }

  function defaultRules() {
    return {
      enter: { enabled: true },
      exit: { enabled: true },
      dwell: { enabled: false, timeoutSec: 60 },
      overspeed: { enabled: false, maxSpeedKmh: 50 },
      minDwellSec: 5,   // 进入确认所需的最小停留时长（防抖）
      minExitSec: 5     // 离开确认所需的最小在外时长（防抖）
    };
  }

  /* 单围栏状态机：
   * out --(inside 持续 >= minDwellSec)--> in  产生 enter 事件
   * in  --(outside 持续 >= minExitSec)--> out 产生 exit 事件
   * 未达阈值就回退的抖动被丢弃，不产生事件。
   * in 状态内累计停留 >= dwell.timeoutSec 触发一次 dwell；
   * in 状态内连续超速合并为一条 overspeed 事件（记录最大速度）。 */
  function simulateFence(fence, points) {
    const rules = Object.assign(defaultRules(), fence.rules || {});
    const events = [];
    let state = 'out';
    let pendingSince = null;   // 候选转换的起始时间
    let enterTime = null;      // 已确认进入的起始时间
    let dwellFired = false;
    let os = null;             // 进行中的超速段 {startT,startLat,startLng,maxSpeed}
    let prev = null;

    function closeOverspeed(endT) {
      if (!os) return;
      events.push({
        fenceId: fence.id, type: 'overspeed', t: os.startT,
        lat: os.startLat, lng: os.startLng,
        reason: '超速：区间内最高 ' + os.maxSpeed.toFixed(1) +
          ' km/h > 阈值 ' + rules.overspeed.maxSpeedKmh + ' km/h，持续至 ' + fmtTime(endT)
      });
      os = null;
    }

    for (const p of points) {
      const inside = pointInPolygon(p.lat, p.lng, fence.polygon);
      if (state === 'out') {
        if (inside) {
          if (pendingSince === null) pendingSince = p.t;
          const held = (p.t - pendingSince) / 1000;
          if (held >= rules.minDwellSec) {
            state = 'in'; enterTime = pendingSince; pendingSince = null;
            if (rules.enter.enabled) {
              events.push({
                fenceId: fence.id, type: 'enter', t: p.t, lat: p.lat, lng: p.lng,
                reason: '进入确认：自 ' + fmtTime(enterTime) + ' 起持续在围栏内 ' +
                  held.toFixed(1) + 's ≥ 最小停留 ' + rules.minDwellSec + 's'
              });
            }
          }
        } else {
          pendingSince = null; // 抖动：未确认就离开，丢弃
        }
      } else { // state === 'in'
        if (!inside) {
          if (pendingSince === null) pendingSince = p.t;
          const held = (p.t - pendingSince) / 1000;
          if (held >= rules.minExitSec) {
            state = 'out'; pendingSince = null; dwellFired = false;
            closeOverspeed(p.t);
            if (rules.exit.enabled) {
              events.push({
                fenceId: fence.id, type: 'exit', t: p.t, lat: p.lat, lng: p.lng,
                reason: '离开确认：持续在围栏外 ' + held.toFixed(1) +
                  's ≥ 最小离开 ' + rules.minExitSec + 's'
              });
            }
          }
        } else {
          pendingSince = null; // 短暂出界未达阈值，视为抖动
        }
        if (state === 'in' && rules.dwell.enabled && !dwellFired &&
            (p.t - enterTime) / 1000 >= rules.dwell.timeoutSec) {
          dwellFired = true;
          events.push({
            fenceId: fence.id, type: 'dwell', t: p.t, lat: p.lat, lng: p.lng,
            reason: '停留超时：已连续停留 ' + ((p.t - enterTime) / 1000).toFixed(1) +
              's ≥ 阈值 ' + rules.dwell.timeoutSec + 's'
          });
        }
        if (state === 'in' && rules.overspeed.enabled && prev) {
          const v = speedKmh(prev, p);
          if (v > rules.overspeed.maxSpeedKmh) {
            if (!os) os = { startT: p.t, startLat: p.lat, startLng: p.lng, maxSpeed: v };
            else os.maxSpeed = Math.max(os.maxSpeed, v);
          } else {
            closeOverspeed(p.t);
          }
        }
      }
      prev = p;
    }
    if (os) closeOverspeed(points.length ? points[points.length - 1].t : os.startT);
    return events;
  }

  // 规则类型优先级：同一时刻冲突时按此顺序保留
  const TYPE_ORDER = { enter: 1, exit: 2, dwell: 3, overspeed: 4 };

  /* 冲突消解：同一秒内的候选事件，按 围栏优先级(数值小者优先) ->
   * 规则类型顺序 排序，仅保留第一条，其余标记为被压制并注明原因。 */
  function resolveConflicts(candidates, fenceById) {
    const groups = new Map();
    for (const ev of candidates) {
      const key = Math.round(ev.t / 1000);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const events = [];
    for (const group of groups.values()) {
      group.sort(function (a, b) {
        const pa = (fenceById[a.fenceId] || {}).priority || 0;
        const pb = (fenceById[b.fenceId] || {}).priority || 0;
        if (pa !== pb) return pa - pb;
        return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      });
      const winner = group[0];
      winner.suppressed = [];
      for (let i = 1; i < group.length; i++) {
        const loser = group[i];
        const wf = fenceById[winner.fenceId] || {};
        const lf = fenceById[loser.fenceId] || {};
        loser.suppressedReason = '与事件[' + (wf.name || winner.fenceId) + '/' +
          winner.type + ']同时刻冲突，对方优先级更高(优先级 ' +
          (wf.priority || 0) + ' < ' + (lf.priority || 0) +
          ' 或规则类型优先)，被压制';
        winner.suppressed.push(loser);
      }
      events.push(winner);
    }
    events.sort(function (a, b) { return a.t - b.t; });
    return events;
  }

  // 主入口：fences + 原始轨迹 -> { events, skipped, points }
  function simulate(fences, rawPoints) {
    const norm = normalizePoints(rawPoints);
    const fenceById = {};
    const candidates = [];
    for (const f of fences || []) {
      if (!f.polygon || f.polygon.length < 3) continue;
      fenceById[f.id] = f;
      for (const ev of simulateFence(f, norm.points)) {
        ev.fenceName = f.name || f.id;
        candidates.push(ev);
      }
    }
    const events = resolveConflicts(candidates, fenceById);
    // 级联压制：进入事件被压制的围栏，其对应驻留的离开事件一并压制，
    // 避免出现“没有进入却有离开”的孤儿事件。
    const suppressedEnters = [];
    for (const ev of events) {
      for (const s of ev.suppressed || []) {
        if (s.type === 'enter') suppressedEnters.push(s);
      }
    }
    suppressedEnters.sort(function (a, b) { return a.t - b.t; });
    const kept = [];
    const cascaded = [];
    for (const ev of events) {
      if (ev.type === 'exit') {
        let lastSupp = null;
        for (const s of suppressedEnters) {
          if (s.fenceId === ev.fenceId && s.t < ev.t) lastSupp = s;
        }
        const enterBetween = lastSupp && kept.some(function (k) {
          return k.fenceId === ev.fenceId && k.type === 'enter' &&
            k.t > lastSupp.t && k.t < ev.t;
        });
        if (lastSupp && !enterBetween) {
          ev.cascadeReason = '该围栏的进入事件被高优先级事件压制，本次离开一并压制';
          cascaded.push(ev);
          continue;
        }
      }
      kept.push(ev);
    }
    return {
      events: kept,
      suppressedCascade: cascaded,
      skipped: norm.skipped,
      points: norm.points
    };
  }

  return {
    haversineM: haversineM,
    pointInPolygon: pointInPolygon,
    parsePoint: parsePoint,
    normalizePoints: normalizePoints,
    speedKmh: speedKmh,
    defaultRules: defaultRules,
    simulateFence: simulateFence,
    resolveConflicts: resolveConflicts,
    simulate: simulate,
    TYPE_ORDER: TYPE_ORDER
  };
});
