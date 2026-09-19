/* core.js — 离线三维空间标注审查工具:核心模型与规则(纯逻辑,浏览器与 Node 通用) */
(function (global) {
'use strict';

/* ---------------- 向量与矩阵(列主序 4x4) ---------------- */
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) {
  var l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function matMul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
    var s = 0;
    for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function matPoint(m, p) {
  var x = p[0], y = p[1], z = p[2];
  var w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
  ];
}
function matInvert(m) {
  /* 通用 4x4 求逆(高斯-若尔当) */
  var n = 4, aug = [], i, j, k;
  for (i = 0; i < n; i++) {
    aug.push([]);
    for (j = 0; j < n; j++) aug[i].push(m[j * 4 + i]);
    for (j = 0; j < n; j++) aug[i].push(i === j ? 1 : 0);
  }
  for (i = 0; i < n; i++) {
    var piv = i;
    for (k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[piv][i])) piv = k;
    if (Math.abs(aug[piv][i]) < 1e-12) return null;
    var tmp = aug[i]; aug[i] = aug[piv]; aug[piv] = tmp;
    var d = aug[i][i];
    for (j = 0; j < 2 * n; j++) aug[i][j] /= d;
    for (k = 0; k < n; k++) {
      if (k === i) continue;
      var f = aug[k][i];
      for (j = 0; j < 2 * n; j++) aug[k][j] -= f * aug[i][j];
    }
  }
  var inv = new Array(16);
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) inv[j * 4 + i] = aug[i][n + j];
  return inv;
}
function matFromTRS(t, rDeg, s) {
  var rx = rDeg[0] * Math.PI / 180, ry = rDeg[1] * Math.PI / 180, rz = rDeg[2] * Math.PI / 180;
  var cx = Math.cos(rx), sx = Math.sin(rx);
  var cy = Math.cos(ry), sy = Math.sin(ry);
  var cz = Math.cos(rz), sz = Math.sin(rz);
  var r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
  var r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
  var r20 = -sy,    r21 = cy * sx,                r22 = cy * cx;
  return [
    r00 * s[0], r10 * s[0], r20 * s[0], 0,
    r01 * s[1], r11 * s[1], r21 * s[1], 0,
    r02 * s[2], r12 * s[2], r22 * s[2], 0,
    t[0], t[1], t[2], 1
  ];
}
function lookAt(eye, target, up) {
  var f = norm(sub(target, eye));
  var s = norm(cross(f, up));
  var u = cross(s, f);
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1
  ];
}

/* ---------------- 状态与日志 ---------------- */
function createState() {
  return {
    objects: new Map(),      /* id -> {id,parentId,position,rotation,scale,size,children,removed} */
    annotations: new Map(),  /* id -> {id,objectId,versions:[{source,anchor,text}],invalid} */
    relations: [],           /* {from,to,type} type: reference|dependency */
    conflicts: [],           /* {annotationId,versions:[{source,anchor,text}]} */
    log: [],                 /* {seq,kind,message} kind: reject|conflict|invalid|info */
    seq: 0
  };
}
function log(state, kind, message) {
  state.log.push({ seq: ++state.seq, kind: kind, message: message });
}
function reject(state, message) {
  log(state, 'reject', message);
  return { ok: false, error: message };
}
function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
function fmtV(v) { return '(' + v.map(function (n) { return +(+n).toFixed(3); }).join(', ') + ')'; }
function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(function (n) { return typeof n === 'number' && isFinite(n); });
}
function objectPath(state, id) {
  var names = [], cur = state.objects.get(id), guard = 0;
  while (cur && guard++ < 1000) { names.unshift(cur.id); cur = cur.parentId ? state.objects.get(cur.parentId) : null; }
  return names.join(' / ');
}

/* ---------------- 需求1:空间对象维护与校验 ---------------- */
function addObject(state, spec) {
  if (!spec || typeof spec.id !== 'string' || spec.id.trim() === '')
    return reject(state, '对象缺少唯一标识 id');
  var id = spec.id;
  if (state.objects.has(id))
    return reject(state, '对象标识重复: "' + id + '" 已存在于 "' + objectPath(state, id) + '"');
  var parentId = spec.parentId == null ? null : spec.parentId;
  if (parentId !== null && !state.objects.has(parentId))
    return reject(state, '对象 "' + id + '" 的父对象 "' + parentId + '" 不存在');
  if (parentId !== null && state.objects.get(parentId).removed)
    return reject(state, '对象 "' + id + '" 的父对象 "' + parentId + '" 已被删除');
  var size = spec.size;
  if (!isVec3(size))
    return reject(state, '对象 "' + id + '" 包围尺寸缺失或非法: ' + JSON.stringify(size));
  for (var i = 0; i < 3; i++) {
    if (!(size[i] > 0))
      return reject(state, '对象 "' + id + '" 包围尺寸非正: 第 ' + (i + 1) + ' 个分量为 ' + size[i] +
        '(位置: ' + (parentId ? '父对象 "' + parentId + '" 下' : '根层级') + ')');
  }
  var position = spec.position || [0, 0, 0];
  var rotation = spec.rotation || [0, 0, 0];
  var scale = spec.scale || [1, 1, 1];
  if (!isVec3(position) || !isVec3(rotation) || !isVec3(scale))
    return reject(state, '对象 "' + id + '" 的局部变换含非法数值');
  var obj = {
    id: id, parentId: parentId,
    position: position.slice(), rotation: rotation.slice(), scale: scale.slice(),
    size: size.slice(), children: [], removed: false
  };
  state.objects.set(id, obj);
  if (parentId) state.objects.get(parentId).children.push(id);
  log(state, 'info', '已登记对象 "' + id + '"' + (parentId ? '(父: "' + parentId + '")' : '(根)'));
  return ok();
}

/* ---------------- 需求1+6:标注维护与多来源冲突 ---------------- */
function versionsEqual(a, b) {
  return a.text === b.text &&
    a.anchor[0] === b.anchor[0] && a.anchor[1] === b.anchor[1] && a.anchor[2] === b.anchor[2];
}
function describeVersion(v) {
  return '来源 "' + v.source + '" 锚点 ' + fmtV(v.anchor) + ' 正文 "' + v.text + '"';
}
function addAnnotation(state, spec, source) {
  var src = source || spec.source || '未命名来源';
  if (!spec || typeof spec.id !== 'string' || spec.id.trim() === '')
    return reject(state, '标注缺少唯一标识 id(来源 "' + src + '")');
  var id = spec.id;
  if (!isVec3(spec.anchor))
    return reject(state, '标注 "' + id + '" 锚点位置非法: ' + JSON.stringify(spec.anchor) + '(来源 "' + src + '")');
  if (typeof spec.text !== 'string')
    return reject(state, '标注 "' + id + '" 缺少正文 text(来源 "' + src + '")');
  var version = { source: src, anchor: spec.anchor.slice(), text: spec.text };
  var existing = state.annotations.get(id);
  if (existing) {
    for (var i = 0; i < existing.versions.length; i++) {
      var v = existing.versions[i];
      if (v.source === src) {
        if (versionsEqual(v, version)) return ok({ note: '重复提交,内容一致,忽略' });
        v.anchor = version.anchor; v.text = version.text;
        upsertConflict(state, existing);
        log(state, 'info', '标注 "' + id + '" 被来源 "' + src + '" 更新');
        return ok();
      }
    }
    if (existing.versions.some(function (x) { return versionsEqual(x, version); }))
      return ok({ note: '内容与其他来源一致,忽略' });
    existing.versions.push(version);
    upsertConflict(state, existing);
    return ok({ conflict: true });
  }
  if (typeof spec.objectId !== 'string' || !state.objects.has(spec.objectId))
    return reject(state, '标注 "' + id + '" 挂载的对象 "' + spec.objectId + '" 不存在(来源 "' + src + '")');
  if (state.objects.get(spec.objectId).removed)
    return reject(state, '标注 "' + id + '" 挂载的对象 "' + spec.objectId + '" 已被删除(来源 "' + src + '")');
  state.annotations.set(id, { id: id, objectId: spec.objectId, versions: [version], invalid: null });
  log(state, 'info', '已登记标注 "' + id + '" 于对象 "' + spec.objectId + '"(来源 "' + src + '")');
  return ok();
}
function upsertConflict(state, ann) {
  var rec = null;
  for (var i = 0; i < state.conflicts.length; i++)
    if (state.conflicts[i].annotationId === ann.id) rec = state.conflicts[i];
  var distinct = [];
  ann.versions.forEach(function (v) {
    if (!distinct.some(function (x) { return versionsEqual(x, v); })) distinct.push(v);
  });
  if (distinct.length < 2) {
    if (rec) state.conflicts.splice(state.conflicts.indexOf(rec), 1);
    return;
  }
  if (!rec) { rec = { annotationId: ann.id, versions: distinct }; state.conflicts.push(rec); }
  else rec.versions = distinct;
  var msg = '标注 "' + ann.id + '" 存在冲突,保留全部 ' + distinct.length + ' 个来源版本: ' +
    distinct.map(describeVersion).join(' 丨 ');
  log(state, 'conflict', msg);
}

/* ---------------- 需求2:标注关系(引用/从属),禁止成环 ---------------- */
function findPath(state, from, to) {
  /* 沿关系边 from -> ... -> to 找一条链,找不到返回 null */
  var adj = new Map();
  state.relations.forEach(function (r) {
    if (!adj.has(r.from)) adj.set(r.from, []);
    adj.get(r.from).push(r.to);
  });
  var prev = new Map(), queue = [from], seen = new Set([from]);
  while (queue.length) {
    var cur = queue.shift();
    if (cur === to) {
      var path = [to], p = to;
      while (prev.has(p)) { p = prev.get(p); path.unshift(p); }
      return path;
    }
    (adj.get(cur) || []).forEach(function (n) {
      if (!seen.has(n)) { seen.add(n); prev.set(n, cur); queue.push(n); }
    });
  }
  return null;
}
function addRelation(state, fromId, toId, type) {
  if (type !== 'reference' && type !== 'dependency')
    return reject(state, '关系类型非法: "' + type + '"(仅支持 reference 引用 / dependency 从属)');
  var missing = [];
  if (!state.annotations.has(fromId)) missing.push(fromId);
  if (!state.annotations.has(toId)) missing.push(toId);
  if (missing.length)
    return reject(state, '关系引用不存在的标注: ' + missing.map(function (m) { return '"' + m + '"'; }).join(', ') +
      '(涉及链条: ' + fromId + ' -> ' + toId + ')');
  if (fromId === toId)
    return reject(state, '关系不允许自环: "' + fromId + '" -> "' + toId + '"');
  var dup = state.relations.some(function (r) { return r.from === fromId && r.to === toId && r.type === type; });
  if (dup) return reject(state, '关系已存在: "' + fromId + '" -> "' + toId + '"(' + type + ')');
  var cycle = findPath(state, toId, fromId);
  if (cycle) {
    cycle.push(fromId);
    return reject(state, '关系成环,已拒绝: ' + cycle.map(function (c) { return '"' + c + '"'; }).join(' -> '));
  }
  state.relations.push({ from: fromId, to: toId, type: type });
  log(state, 'info', '已建立' + (type === 'reference' ? '引用' : '从属') + '关系: "' + fromId + '" -> "' + toId + '"');
  return ok();
}

/* ---------------- 需求4:对象变换(标注随动在投影时实时体现) ---------------- */
function transformObject(state, id, t) {
  var obj = state.objects.get(id);
  if (!obj || obj.removed) return reject(state, '对象 "' + id + '" 不存在或已删除,无法变换');
  var np = t.position || obj.position, nr = t.rotation || obj.rotation, ns = t.scale || obj.scale;
  if (!isVec3(np) || !isVec3(nr) || !isVec3(ns))
    return reject(state, '对象 "' + id + '" 的变换含非法数值');
  for (var i = 0; i < 3; i++)
    if (ns[i] === 0) return reject(state, '对象 "' + id + '" 缩放第 ' + (i + 1) + ' 个分量为 0,不可逆');
  obj.position = np.slice(); obj.rotation = nr.slice(); obj.scale = ns.slice();
  log(state, 'info', '对象 "' + id + '" 变换: 平移 ' + fmtV(np) + ' 旋转 ' + fmtV(nr) + ' 缩放 ' + fmtV(ns));
  return ok();
}

/* ---------------- 世界变换与锚点 ---------------- */
function worldMatrix(state, id) {
  var chain = [], cur = state.objects.get(id), guard = 0;
  while (cur && guard++ < 1000) { chain.unshift(cur); cur = cur.parentId ? state.objects.get(cur.parentId) : null; }
  var m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  chain.forEach(function (o) { m = matMul(m, matFromTRS(o.position, o.rotation, o.scale)); });
  return m;
}
function effectiveVersion(ann) { return ann.versions[0]; }
function worldAnchor(state, ann) {
  if (ann.invalid) return ann.invalid.worldAnchor.slice();
  var m = worldMatrix(state, ann.objectId);
  return matPoint(m, effectiveVersion(ann).anchor);
}

/* ---------------- 需求5:删除/改挂时保留锚点证据并标记失效 ---------------- */
function invalidateAnnotations(state, objectId, reason) {
  var count = 0;
  state.annotations.forEach(function (ann) {
    if (ann.objectId !== objectId || ann.invalid) return;
    var m = worldMatrix(state, objectId);
    ann.invalid = {
      reason: reason,
      objectId: objectId,
      localAnchor: effectiveVersion(ann).anchor.slice(),
      worldAnchor: matPoint(m, effectiveVersion(ann).anchor),
      text: effectiveVersion(ann).text,
      seq: state.seq + 1
    };
    count++;
    log(state, 'invalid', '标注 "' + ann.id + '" 失效(' + reason + '),保留证据: 原对象 "' + objectId +
      '" 局部锚点 ' + fmtV(ann.invalid.localAnchor) + ' 世界锚点 ' + fmtV(ann.invalid.worldAnchor) +
      ' 正文 "' + ann.invalid.text + '"');
  });
  return count;
}
function deleteObject(state, id) {
  var obj = state.objects.get(id);
  if (!obj || obj.removed) return reject(state, '对象 "' + id + '" 不存在或已删除');
  invalidateAnnotations(state, id, '对象被删除');
  obj.removed = true;
  if (obj.parentId) {
    var p = state.objects.get(obj.parentId);
    p.children = p.children.filter(function (c) { return c !== id; });
  }
  /* 子对象改挂到被删对象的父级,避免层级整体丢失 */
  obj.children.slice().forEach(function (cid) {
    var child = state.objects.get(cid);
    child.parentId = obj.parentId;
    if (obj.parentId) state.objects.get(obj.parentId).children.push(cid);
    log(state, 'info', '子对象 "' + cid + '" 随删除改挂到 "' + (obj.parentId || '(根)') + '"');
  });
  obj.children = [];
  log(state, 'info', '对象 "' + id + '" 已删除,其标注保留证据并标记失效');
  return ok();
}
function reparentObject(state, id, newParentId) {
  var obj = state.objects.get(id);
  if (!obj || obj.removed) return reject(state, '对象 "' + id + '" 不存在或已删除');
  var np = newParentId == null ? null : newParentId;
  if (np !== null && (!state.objects.has(np) || state.objects.get(np).removed))
    return reject(state, '目标父对象 "' + np + '" 不存在或已删除');
  if (np === id) return reject(state, '对象 "' + id + '" 不能改挂到自身');
  var cur = np, guard = 0;
  while (cur && guard++ < 1000) {
    if (cur === id) return reject(state, '改挂会在对象层级中成环: "' + id + '" 是 "' + np + '" 的祖先');
    cur = state.objects.get(cur) ? state.objects.get(cur).parentId : null;
  }
  if (obj.parentId === np) return ok({ note: '父对象未变化' });
  invalidateAnnotations(state, id, '父对象被改挂');
  if (obj.parentId) {
    var p = state.objects.get(obj.parentId);
    p.children = p.children.filter(function (c) { return c !== id; });
  }
  obj.parentId = np;
  if (np) state.objects.get(np).children.push(id);
  log(state, 'info', '对象 "' + id + '" 已改挂到 "' + (np || '(根)') + '",其标注保留证据并标记失效');
  return ok();
}

/* ---------------- 需求3:视图投影、视窗判定与遮挡 ---------------- */
function cameraEye(cam) {
  var yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
  var cp = Math.cos(pitch);
  return [
    cam.target[0] + cam.distance * cp * Math.sin(yaw),
    cam.target[1] + cam.distance * Math.sin(pitch),
    cam.target[2] + cam.distance * cp * Math.cos(yaw)
  ];
}
function projectPoint(view, viewport, p) {
  var c = matPoint(view, p);
  var z = -c[2]; /* 相机前方距离 */
  if (z <= 1e-6) return { screen: null, depth: z, behind: true };
  var f = 1 / Math.tan((viewport.fov * Math.PI / 180) / 2);
  var aspect = viewport.width / viewport.height;
  var ndcX = (c[0] * f / aspect) / z;
  var ndcY = (c[1] * f) / z;
  return {
    screen: [(ndcX + 1) / 2 * viewport.width, (1 - ndcY) / 2 * viewport.height],
    ndc: [ndcX, ndcY], depth: z, behind: false
  };
}
function rayHitsBox(inv, half, eye, dir, maxT) {
  /* 在盒体局部空间做 slab 求交,盒体为 [-half, half] */
  var le = matPoint(inv, eye);
  var ld = [
    inv[0] * dir[0] + inv[4] * dir[1] + inv[8] * dir[2],
    inv[1] * dir[0] + inv[5] * dir[1] + inv[9] * dir[2],
    inv[2] * dir[0] + inv[6] * dir[1] + inv[10] * dir[2]
  ];
  var tmin = 0, tmax = maxT;
  for (var i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-12) {
      if (le[i] < -half[i] || le[i] > half[i]) return false;
    } else {
      var t1 = (-half[i] - le[i]) / ld[i], t2 = (half[i] - le[i]) / ld[i];
      if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return tmin < maxT - 1e-6;
}
function computeView(state, cam, viewport) {
  var eye = cameraEye(cam);
  var view = lookAt(eye, cam.target, [0, 1, 0]);
  var boxes = [];
  state.objects.forEach(function (o) {
    if (o.removed) return;
    var m = worldMatrix(state, o.id);
    boxes.push({ id: o.id, matrix: m, inv: matInvert(m), half: [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2] });
  });
  var annotations = [];
  state.annotations.forEach(function (ann) {
    /* 容器(祖先)对象不算遮挡物:标注在其内部属正常 */
    var skip = {};
    var cur = ann.objectId, guard = 0;
    while (cur && guard++ < 1000) { skip[cur] = true; var o = state.objects.get(cur); cur = o ? o.parentId : null; }
    var wp = worldAnchor(state, ann);
    var proj = projectPoint(view, viewport, wp);
    var status;
    if (ann.invalid) status = 'invalid';
    else if (proj.behind || !proj.screen) status = 'outside';
    else if (Math.abs(proj.ndc[0]) > 1 || Math.abs(proj.ndc[1]) > 1) status = 'outside';
    else {
      var dir = sub(wp, eye);
      var dist = Math.hypot(dir[0], dir[1], dir[2]);
      dir = [dir[0] / dist, dir[1] / dist, dir[2] / dist];
      status = 'visible';
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (skip[b.id] || !b.inv) continue;
        if (rayHitsBox(b.inv, b.half, eye, dir, dist)) { status = 'occluded'; break; }
      }
    }
    annotations.push({
      id: ann.id, objectId: ann.objectId,
      world: wp, screen: proj.screen, depth: proj.depth,
      status: status, conflicted: state.conflicts.some(function (c) { return c.annotationId === ann.id; }),
      invalid: !!ann.invalid
    });
  });
  return { eye: eye, view: view, boxes: boxes, annotations: annotations };
}
function boxCornersWorld(state, id) {
  var o = state.objects.get(id);
  var m = worldMatrix(state, id);
  var h = [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2], out = [];
  for (var i = 0; i < 8; i++)
    out.push(matPoint(m, [(i & 1 ? 1 : -1) * h[0], (i & 2 ? 1 : -1) * h[1], (i & 4 ? 1 : -1) * h[2]]));
  return out;
}

var Core = {
  createState: createState,
  addObject: addObject, addAnnotation: addAnnotation, addRelation: addRelation,
  transformObject: transformObject, deleteObject: deleteObject, reparentObject: reparentObject,
  computeView: computeView, worldAnchor: worldAnchor, worldMatrix: worldMatrix,
  boxCornersWorld: boxCornersWorld, cameraEye: cameraEye, projectPoint: projectPoint,
  lookAt: lookAt, objectPath: objectPath
};
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
global.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
