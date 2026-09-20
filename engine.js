/* 坐标转换与精度推演引擎：纯逻辑，浏览器与 Node 通用。
 * 坐标统一用 {lat, lng} 存放；WEBMERC 表示下 lat=y(米)、lng=x(米)。
 * 精度模型：各步骤误差相互独立，按平方和根(RSS)合成。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Engine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const REPS = ['WGS84', 'GCJ02', 'BD09', 'WEBMERC'];
  const PI = Math.PI;
  const A = 6378245.0;
  const EE = 0.00669342162296594323;
  const X_PI = PI * 3000.0 / 180.0;
  const R_EARTH = 6378137.0;

  function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }
  function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
  }
  function gcj02ToWgs84(lat, lng) {
    if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
    let pLat = lat, pLng = lng;
    for (let i = 0; i < 6; i++) {
      const g = wgs84ToGcj02(pLat, pLng);
      pLat = pLat - (g.lat - lat);
      pLng = pLng - (g.lng - lng);
    }
    return { lat: pLat, lng: pLng };
  }
  function gcj02ToBd09(lat, lng) {
    const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
    const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
    return { lat: z * Math.sin(theta) + 0.006, lng: z * Math.cos(theta) + 0.0065 };
  }
  function bd09ToGcj02(lat, lng) {
    // 闭式反解作初值，再不动点迭代精化，往返误差可降至 1e-10 度量级
    const x = lng - 0.0065, y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    let pLat = z * Math.sin(theta), pLng = z * Math.cos(theta);
    for (let i = 0; i < 4; i++) {
      const b = gcj02ToBd09(pLat, pLng);
      pLat = pLat - (b.lat - lat);
      pLng = pLng - (b.lng - lng);
    }
    return { lat: pLat, lng: pLng };
  }
  function wgs84ToWebMerc(lat, lng) {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return {
      lat: R_EARTH * Math.log(Math.tan(PI / 4 + clamped * PI / 360)),
      lng: R_EARTH * lng * PI / 180
    };
  }
  function webMercToWgs84(lat, lng) {
    return {
      lat: (2 * Math.atan(Math.exp(lat / R_EARTH)) - PI / 2) * 180 / PI,
      lng: lng / R_EARTH * 180 / PI
    };
  }

  const CONVERTERS = {
    'WGS84>GCJ02': wgs84ToGcj02,
    'GCJ02>WGS84': gcj02ToWgs84,
    'GCJ02>BD09': gcj02ToBd09,
    'BD09>GCJ02': bd09ToGcj02,
    'WGS84>WEBMERC': wgs84ToWebMerc,
    'WEBMERC>WGS84': webMercToWgs84
  };

  function combineAcc(accBefore, loss) {
    return Math.sqrt(accBefore * accBefore + loss * loss);
  }

  function applyDatumShift(coord, dc, rep) {
    if (rep === 'WEBMERC') {
      return { lat: coord.lat + (dc.dNorth || 0), lng: coord.lng + (dc.dEast || 0) };
    }
    const dLat = (dc.dNorth || 0) / 111132.954;
    const cosLat = Math.cos(coord.lat * PI / 180);
    const dLng = (dc.dEast || 0) / (111412.84 * (Math.abs(cosLat) < 1e-12 ? 1e-12 : cosLat));
    return { lat: coord.lat + dLat, lng: coord.lng + dLng };
  }

  /* 沿转换链逐点推演，返回完整轨迹；断链时拒绝给出最终坐标。 */
  function computeTrace(point, chain) {
    const trace = {
      pointId: point.id, chainId: chain ? chain.id : null,
      status: 'ok', steps: [], breakIndex: -1, breakReason: '', final: null
    };
    if (!chain) {
      trace.status = 'broken';
      trace.breakReason = '该点未指定转换链，或转换链不存在';
      return trace;
    }
    let coord = { lat: point.lat, lng: point.lng };
    let acc = point.accuracy;
    let rep = point.rep;
    trace.origin = { lat: coord.lat, lng: coord.lng, rep: rep, accuracy: acc, datum: point.datum };

    const dc = (chain.datumCorrections || {})[point.datum];
    if (dc && (dc.dEast || dc.dNorth || dc.loss)) {
      const before = { lat: coord.lat, lng: coord.lng };
      coord = applyDatumShift(coord, dc, rep);
      const after = combineAcc(acc, dc.loss || 0);
      trace.steps.push({
        kind: 'datum', name: '基准校正[' + point.datum + ']', srcRep: rep, dstRep: rep,
        input: before, output: { lat: coord.lat, lng: coord.lng },
        accBefore: acc, loss: dc.loss || 0, accAfter: after
      });
      acc = after;
    }

    const steps = chain.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.src !== rep) {
        trace.status = 'broken';
        trace.breakIndex = i;
        trace.breakReason = '表示不匹配：第 ' + (i + 1) + ' 步「' + st.name + '」期望输入 ' + st.src + '，当前为 ' + rep;
        return trace;
      }
      const conv = CONVERTERS[st.src + '>' + st.dst];
      if (!conv) {
        trace.status = 'broken';
        trace.breakIndex = i;
        trace.breakReason = '缺少转换实现：' + st.src + ' -> ' + st.dst;
        return trace;
      }
      const before = { lat: coord.lat, lng: coord.lng };
      coord = conv(coord.lat, coord.lng);
      const after = combineAcc(acc, st.loss || 0);
      trace.steps.push({
        kind: 'convert', index: i, stepId: st.id, name: st.name,
        srcRep: st.src, dstRep: st.dst,
        input: before, output: { lat: coord.lat, lng: coord.lng },
        accBefore: acc, loss: st.loss || 0, accAfter: after
      });
      acc = after;
      rep = st.dst;
    }
    trace.final = { lat: coord.lat, lng: coord.lng, rep: rep, accuracy: acc };
    return trace;
  }

  /* 链定义自检：相邻步骤表示是否衔接、转换是否有实现。 */
  function validateChain(chain) {
    const issues = [];
    const steps = chain.steps || [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (!CONVERTERS[st.src + '>' + st.dst]) {
        issues.push('第 ' + (i + 1) + ' 步「' + st.name + '」缺少转换实现：' + st.src + ' -> ' + st.dst);
      }
      if (i > 0 && steps[i - 1].dst !== st.src) {
        issues.push('第 ' + i + ' 步输出 ' + steps[i - 1].dst + ' 与第 ' + (i + 1) + ' 步输入 ' + st.src + ' 不衔接');
      }
    }
    return issues;
  }

  function chainById(chains, id) {
    for (let i = 0; i < chains.length; i++) if (chains[i].id === id) return chains[i];
    return null;
  }

  /* 全量重推：所有点从头完整换算。 */
  function recomputeAll(points, chains) {
    const traces = {};
    points.forEach(function (p) {
      traces[p.id] = computeTrace(p, chainById(chains, p.chainId));
    });
    return traces;
  }

  /* 变更影响面分析：只挑出需要重推的点。
   * change: {type:'step'|'chain', chainId} 链或步骤变化 -> 该链上全部点
   *         {type:'datum', chainId, datum} 基准参数变化 -> 该链上该基准的点
   *         {type:'point', pointId} 点本身变化 -> 仅该点
   */
  function affectedPointIds(points, change) {
    if (change.type === 'point') return [change.pointId];
    return points.filter(function (p) {
      if (p.chainId !== change.chainId) return false;
      if (change.type === 'datum') return p.datum === change.datum;
      return true;
    }).map(function (p) { return p.id; });
  }

  /* 增量重推：仅重算受影响点，返回 {traces, affectedIds}。 */
  function recomputeAffected(points, chains, change) {
    const ids = affectedPointIds(points, change);
    const traces = {};
    ids.forEach(function (id) {
      const p = points.filter(function (q) { return q.id === id; })[0];
      if (p) traces[id] = computeTrace(p, chainById(chains, p.chainId));
    });
    return { traces: traces, affectedIds: ids };
  }

  /* 一致性校验：增量结果必须与全量重推完全一致。 */
  function tracesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function verifyConsistent(points, chains, change) {
    const inc = recomputeAffected(points, chains, change);
    const full = recomputeAll(points, chains);
    const ok = inc.affectedIds.every(function (id) {
      return tracesEqual(inc.traces[id], full[id]);
    });
    return { ok: ok, affectedIds: inc.affectedIds, traces: inc.traces, full: full };
  }

  return {
    REPS: REPS,
    CONVERTERS: CONVERTERS,
    combineAcc: combineAcc,
    computeTrace: computeTrace,
    validateChain: validateChain,
    recomputeAll: recomputeAll,
    recomputeAffected: recomputeAffected,
    affectedPointIds: affectedPointIds,
    verifyConsistent: verifyConsistent
  };
});
