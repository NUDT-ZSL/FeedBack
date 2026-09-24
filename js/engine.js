/* engine.js — 位置对象范围查找推演引擎
 * 原则：保留全部来源记录；冲突字段不静默择一；不可信对象不参与邻近排序；
 * 修正/撤回/裁决只触发受影响查找的增量重推。
 * 该文件同时可被浏览器与 Node（测试）加载。
 */
(function (global) {
'use strict';

const BOUNDARY_EPS = 0.75; // 距范围边界小于该值视为“压线”歧义

// ---------------- 几何 ----------------
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

function shapeCenter(shape) {
  if (shape.type === 'circle') return { x: shape.cx, y: shape.cy };
  return { x: (shape.minX + shape.maxX) / 2, y: (shape.minY + shape.maxY) / 2 };
}

function containsPoint(shape, p) {
  if (shape.type === 'circle') return dist(p, { x: shape.cx, y: shape.cy }) <= shape.r + 1e-9;
  return p.x >= shape.minX - 1e-9 && p.x <= shape.maxX + 1e-9 &&
         p.y >= shape.minY - 1e-9 && p.y <= shape.maxY + 1e-9;
}

// 到边界的距离（内部为到最近边的距离，外部为到形状的距离）
function distanceToBoundary(shape, p) {
  if (shape.type === 'circle') return Math.abs(dist(p, { x: shape.cx, y: shape.cy }) - shape.r);
  if (containsPoint(shape, p)) {
    return Math.min(p.x - shape.minX, shape.maxX - p.x, p.y - shape.minY, shape.maxY - p.y);
  }
  const ox = Math.max(shape.minX - p.x, 0, p.x - shape.maxX);
  const oy = Math.max(shape.minY - p.y, 0, p.y - shape.maxY);
  return Math.sqrt(ox * ox + oy * oy);
}

function inWorld(world, p) {
  return p.x >= world.minX && p.x <= world.maxX && p.y >= world.minY && p.y <= world.maxY;
}

// 两个范围是否“部分重叠”（内部相交且互不包含）——重叠歧义判定
function shapesOverlap(a, b) {
  if (a.type === 'circle' && b.type === 'circle') {
    const d = dist({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy });
    return d < a.r + b.r - 1e-9 && d + Math.min(a.r, b.r) > Math.max(a.r, b.r) + 1e-9;
  }
  if (a.type === 'rect' && b.type === 'rect') {
    const inter = a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
    const aInB = a.minX >= b.minX && a.maxX <= b.maxX && a.minY >= b.minY && a.maxY <= b.maxY;
    const bInA = b.minX >= a.minX && b.maxX <= a.maxX && b.minY >= a.minY && b.maxY <= a.maxY;
    return inter && !aInB && !bInA;
  }
  const c = a.type === 'circle' ? a : b, r = a.type === 'circle' ? b : a;
  const nx = Math.max(r.minX, Math.min(c.cx, r.maxX));
  const ny = Math.max(r.minY, Math.min(c.cy, r.maxY));
  if (dist({ x: c.cx, y: c.cy }, { x: nx, y: ny }) >= c.r - 1e-9) return false;
  const cInR = c.cx - c.r >= r.minX && c.cx + c.r <= r.maxX && c.cy - c.r >= r.minY && c.cy + c.r <= r.maxY;
  const cornersInC = [[r.minX, r.minY], [r.minX, r.maxY], [r.maxX, r.minY], [r.maxX, r.maxY]]
    .every(function (pt) { return dist({ x: pt[0], y: pt[1] }, { x: c.cx, y: c.cy }) <= c.r; });
  return !cInR && !cornersInC;
}

// ---------------- 来源归并与冲突标记 ----------------
var FIELD_GETTERS = {
  coord: function (r) { return r.coord != null ? r.coord : null; },
  category: function (r) { return r.category != null ? r.category : null; },
  validFrom: function (r) { return r.validFrom != null ? r.validFrom : null; },
  validTo: function (r) { return r.validTo != null ? r.validTo : null; }
};

function valueKey(v) { return v == null ? '∅' : JSON.stringify(v); }

function groupValues(records, get) {
  const m = new Map();
  for (const r of records) {
    const v = get(r);
    const k = valueKey(v);
    if (!m.has(k)) m.set(k, { value: v, sources: [] });
    m.get(k).sources.push(r.source);
  }
  return Array.from(m.values());
}

function fmtCoord(c) { return c ? '(' + c.x + ',' + c.y + ')' : '缺失'; }

// 归并一个对象的全部来源记录，输出每个字段的状态与候选值（保留来源）
function resolveObject(obj, world) {
  const active = obj.records.filter(function (r) { return !r.withdrawn; });
  const adj = obj.adjudications || {};
  const fields = {};
  const conflicts = [];
  const reasons = [];

  for (const name of Object.keys(FIELD_GETTERS)) {
    const groups = groupValues(active, FIELD_GETTERS[name]);
    const present = groups.filter(function (g) { return g.value != null; });
    const missing = groups.find(function (g) { return g.value == null; });
    let status, value = null;
    if (adj[name]) {
      status = 'adjudicated'; value = adj[name].value;
    } else if (present.length === 0) {
      status = 'missing';
    } else if (present.length === 1 && !missing) {
      status = 'agreed'; value = present[0].value;
    } else if (present.length === 1 && missing) {
      status = 'partial-missing'; value = present[0].value;
      conflicts.push('字段 ' + name + ' 在来源 [' + missing.sources.join(',') + '] 中缺失，其余来源一致');
    } else {
      status = 'contested';
      conflicts.push('字段 ' + name + ' 来源互相矛盾：' + present.map(function (g) {
        return JSON.stringify(g.value) + '←[' + g.sources.join(',') + ']';
      }).join('；'));
    }
    fields[name] = { status: status, value: value, candidates: groups };
  }

  // 有效期互相矛盾：来源给出的有效期区间两两不相交
  const intervals = active
    .filter(function (r) { return r.validFrom && r.validTo; })
    .map(function (r) { return { from: r.validFrom, to: r.validTo, source: r.source }; });
  let validityContradiction = false;
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervals[i].to < intervals[j].from || intervals[j].to < intervals[i].from) {
        validityContradiction = true;
        conflicts.push('有效期区间互不相交：[' + intervals[i].from + '~' + intervals[i].to + ']←' +
          intervals[i].source + ' 与 [' + intervals[j].from + '~' + intervals[j].to + ']←' + intervals[j].source);
      }
    }
  }

  // 越界检查：任何候选坐标越界都标记该来源值不可信（但保留）
  const coordField = fields.coord;
  const oobSources = [];
  for (const g of coordField.candidates) {
    if (g.value && !inWorld(world, g.value)) oobSources.push(g.sources.join(','));
  }
  if (oobSources.length) {
    conflicts.push('坐标越出世界边界，来源：' + oobSources.join(',') + '（该值标为不可信）');
  }

  // 不可信判定：任一关键字段未解决，对象不得参与邻近排序
  if (coordField.status === 'missing') reasons.push('所有在册来源均缺失坐标');
  if (coordField.status === 'contested') reasons.push('坐标来源互相矛盾且未裁决');
  if (coordField.value && !inWorld(world, coordField.value)) reasons.push('有效坐标越出世界边界');
  if (fields.category.status === 'contested') reasons.push('类别来源互相矛盾且未裁决');
  if (fields.category.status === 'missing') reasons.push('所有在册来源均缺失类别');
  if (fields.validFrom.status === 'contested' || fields.validTo.status === 'contested') {
    reasons.push('有效期来源互相矛盾且未裁决');
  }
  if (validityContradiction && !(adj.validFrom && adj.validTo)) reasons.push('有效期区间互不相交且未裁决');

  return {
    id: obj.id,
    fields: fields,
    conflicts: conflicts,
    untrustedReasons: reasons,
    trusted: reasons.length === 0,
    adjudications: adj,
    activeRecords: active,
    withdrawnRecords: obj.records.filter(function (r) { return r.withdrawn; })
  };
}

// ---------------- 查找评估 ----------------
function passesCategory(res, filterCats) {
  if (!filterCats || !filterCats.length) return true;
  const cat = res.fields.category.value;
  return cat != null && filterCats.indexOf(cat) >= 0;
}

function validityCovers(res, asOf) {
  const from = res.fields.validFrom.value, to = res.fields.validTo.value;
  if (from && asOf < from) return false;
  if (to && asOf > to) return false;
  return true;
}

// 对象是否与查询“相关”（增量重推的依赖判定）
function relevantToQuery(res, query) {
  const cats = (query.filters && query.filters.categories) || [];
  if (!cats.length) return true;
  if (res.fields.category.status === 'contested' || res.fields.category.status === 'missing') return true;
  return passesCategory(res, cats);
}

function evaluateQuery(query, resolutions, allQueries) {
  const hits = [];
  const excluded = [];
  const ambiguities = [];
  const filters = query.filters || {};
  const center = shapeCenter(query.shape);

  for (const res of resolutions) {
    const basis = [];
    if (!res.trusted) {
      excluded.push({ objectId: res.id, basis: ['对象不可信，不参与邻近排序：'].concat(res.untrustedReasons) });
      if (relevantToQuery(res, query)) {
        ambiguities.push('对象 ' + res.id + ' 的类别/有效期来源冲突与本查询过滤条件相关，裁决前无法确定归属');
      }
      continue;
    }
    if (!passesCategory(res, filters.categories)) {
      excluded.push({ objectId: res.id, basis: ['类别 ' + JSON.stringify(res.fields.category.value) +
        ' 不在过滤集合 ' + JSON.stringify(filters.categories) + ' 内'] });
      continue;
    }
    basis.push('类别 ' + JSON.stringify(res.fields.category.value) + ' 满足过滤条件');
    if (filters.asOf) {
      if (!validityCovers(res, filters.asOf)) {
        excluded.push({ objectId: res.id, basis: ['在基准日 ' + filters.asOf + ' 不在有效期 ' +
          (res.fields.validFrom.value || '?') + '~' + (res.fields.validTo.value || '?') + ' 内'] });
        continue;
      }
      basis.push('基准日 ' + filters.asOf + ' 落在有效期 ' +
        (res.fields.validFrom.value || '-∞') + '~' + (res.fields.validTo.value || '+∞') + ' 内');
    }
    const p = res.fields.coord.value;
    if (!containsPoint(query.shape, p)) {
      excluded.push({ objectId: res.id, basis: ['坐标 ' + fmtCoord(p) + ' 在范围外，距边界 ' +
        distanceToBoundary(query.shape, p).toFixed(2)] });
      continue;
    }
    const dCenter = dist(p, center);
    const dEdge = distanceToBoundary(query.shape, p);
    basis.push('坐标 ' + fmtCoord(p) + ' 落在范围内，距参照点 ' + dCenter.toFixed(2));
    const objAmb = [];
    if (dEdge <= BOUNDARY_EPS) {
      objAmb.push('对象恰好压在范围边界上（距边界 ' + dEdge.toFixed(2) + '），按“闭区间含边界”规则纳入');
    }
    hits.push({ objectId: res.id, distance: dCenter, basis: basis, ambiguities: objAmb });
  }

  // 邻近顺序：按到范围参照点（圆心/矩形中心）的距离升序
  hits.sort(function (a, b) { return a.distance - b.distance || (a.objectId < b.objectId ? -1 : 1); });
  hits.forEach(function (h, i) { h.rank = i + 1; });

  // 范围边界重叠歧义
  for (const other of allQueries) {
    if (other.id === query.id) continue;
    if (shapesOverlap(query.shape, other.shape)) {
      ambiguities.push('本范围与查询 ' + other.id + ' 的范围部分重叠，重叠区内对象的归属需结合两个查询各自的判定依据');
    }
  }
  for (const h of hits) {
    for (const a of h.ambiguities) ambiguities.push('对象 ' + h.objectId + '：' + a);
  }

  return { queryId: query.id, hits: hits, excluded: excluded, ambiguities: ambiguities };
}

// ---------------- 引擎：导入 / 事件 / 增量重推 ----------------
class Engine {
  constructor(world) {
    this.world = world || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    this.objects = new Map();   // id -> { id, records:[], adjudications:{} }
    this.queries = new Map();   // id -> query
    this.resolutions = new Map();
    this.results = new Map();
    this.events = [];
  }

  addRecord(rec) {
    if (!this.objects.has(rec.objectId)) {
      this.objects.set(rec.objectId, { id: rec.objectId, records: [], adjudications: {} });
    }
    this.objects.get(rec.objectId).records.push(rec);
  }

  importData(data) {
    if (data.world) this.world = data.world;
    for (const rec of (data.objects || [])) this.addRecord(rec);
    for (const q of (data.queries || [])) this.queries.set(q.id, q);
    this.fullRecompute();
  }

  resolveOne(id) {
    const res = resolveObject(this.objects.get(id), this.world);
    this.resolutions.set(id, res);
    return res;
  }

  queryList() { return Array.from(this.queries.values()); }

  evaluateOne(query) {
    return evaluateQuery(query, Array.from(this.resolutions.values()), this.queryList());
  }

  fullRecompute() {
    for (const id of this.objects.keys()) this.resolveOne(id);
    for (const q of this.queryList()) this.results.set(q.id, this.evaluateOne(q));
  }

  // 应用事件：correct(修正/补充来源) | withdraw(撤回来源) | adjudicate(人工裁决) | updateQuery(调整范围/过滤)
  // 只重推受影响的查询，返回受影响查询 id 列表。
  applyEvent(evt) {
    this.events.push(evt);
    if (evt.type === 'updateQuery') {
      const old = this.queries.get(evt.query.id);
      this.queries.set(evt.query.id, evt.query);
      const affected = new Set([evt.query.id]);
      // 范围重叠关系可能变化：与旧/新形状重叠的其它查询也需刷新歧义说明
      for (const q of this.queryList()) {
        if (q.id === evt.query.id) continue;
        if ((old && shapesOverlap(old.shape, q.shape)) || shapesOverlap(evt.query.shape, q.shape)) {
          affected.add(q.id);
        }
      }
      for (const qid of affected) this.results.set(qid, this.evaluateOne(this.queries.get(qid)));
      return { affectedQueries: Array.from(affected) };
    }

    let objectId = evt.objectId;
    if (evt.type === 'correct') {
      this.addRecord(Object.assign({ corrected: true }, evt.record));
      objectId = evt.record.objectId;
    } else if (evt.type === 'withdraw') {
      const obj = this.objects.get(evt.objectId);
      if (!obj) throw new Error('未知对象 ' + evt.objectId);
      const rec = obj.records.find(function (r) { return r.source === evt.source && !r.withdrawn; });
      if (!rec) throw new Error('对象 ' + evt.objectId + ' 无在册来源 ' + evt.source);
      rec.withdrawn = true;
    } else if (evt.type === 'adjudicate') {
      const obj = this.objects.get(evt.objectId);
      if (!obj) throw new Error('未知对象 ' + evt.objectId);
      obj.adjudications[evt.field] = { value: evt.value, by: evt.by || '人工裁决', at: evt.at || new Date().toISOString() };
    } else {
      throw new Error('未知事件类型 ' + evt.type);
    }

    const oldRes = this.resolutions.get(objectId);
    const newRes = this.resolveOne(objectId);
    const affected = [];
    // 可信状态翻转会改变所有查询中该对象的排除理由（不可信 ↔ 具体过滤原因），需全量刷新
    const trustChanged = !oldRes || oldRes.trusted !== newRes.trusted;
    for (const q of this.queryList()) {
      const wasRelevant = oldRes ? relevantToQuery(oldRes, q) : true;
      if (trustChanged || wasRelevant || relevantToQuery(newRes, q)) {
        this.results.set(q.id, this.evaluateOne(q));
        affected.push(q.id);
      }
    }
    return { affectedQueries: affected };
  }
}

const api = {
  Engine: Engine,
  BOUNDARY_EPS: BOUNDARY_EPS,
  _internal: {
    dist: dist, shapeCenter: shapeCenter, containsPoint: containsPoint,
    distanceToBoundary: distanceToBoundary, shapesOverlap: shapesOverlap,
    resolveObject: resolveObject, evaluateQuery: evaluateQuery, relevantToQuery: relevantToQuery
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else global.GeoEngine = api;

})(typeof window !== 'undefined' ? window : globalThis);
