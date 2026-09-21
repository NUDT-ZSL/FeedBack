/* scene.js - scene state: parts, annotations, anchor re-derivation, validity. */
(function (root, factory) {
  const M3 = (typeof module !== 'undefined' && module.exports) ? require('./math3d.js') : root.Math3D;
  const S = factory(M3);
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.Scene = S;
})(typeof self !== 'undefined' ? self : this, function (M3) {
  'use strict';
  const EPS = 1e-6;
  let nextPartId = 1, nextAnnId = 1;

  const state = { parts: [], annotations: [] };

  function createPart(opts) {
    opts = opts || {};
    const part = {
      id: 'P' + (nextPartId++),
      name: opts.name || ('Part ' + (nextPartId - 1)),
      pos: M3.v3(opts.pos && opts.pos.x, opts.pos && opts.pos.y, opts.pos && opts.pos.z),
      rot: M3.v3(opts.rot && opts.rot.x, opts.rot && opts.rot.y, opts.rot && opts.rot.z), // degrees
      size: M3.v3(
        Math.max(0.01, (opts.size && opts.size.x) || 1),
        Math.max(0.01, (opts.size && opts.size.y) || 1),
        Math.max(0.01, (opts.size && opts.size.z) || 1)),
      scale: M3.v3(
        (opts.scale && opts.scale.x) != null ? opts.scale.x : 1,
        (opts.scale && opts.scale.y) != null ? opts.scale.y : 1,
        (opts.scale && opts.scale.z) != null ? opts.scale.z : 1),
    };
    state.parts.push(part);
    return part;
  }

  function findPart(id) { return state.parts.find((p) => p.id === id) || null; }

  function deletePart(id) {
    const i = state.parts.findIndex((p) => p.id === id);
    if (i >= 0) state.parts.splice(i, 1);
    // Annotations on the removed part are NOT dropped; recompute() flags them.
    recompute();
  }

  function partMatrix(part) { return M3.composeTRS(part.pos, part.rot, part.scale); }
  function partInverse(part) { return M3.invertTRS(part.pos, part.rot, part.scale); }

  // Anchor lives in the part's local frame: the unscaled box spans +/-size/2.
  function createAnnotation(partId, local, text) {
    const ann = {
      id: 'A' + (nextAnnId++),
      partId,
      local: M3.v3(local.x, local.y, local.z),
      text: text || ('Annotation ' + nextAnnId),
      offset: { x: 40, y: -36 },   // 2D label offset in screen pixels
      valid: false,
      invalidReason: null,
      world: null,                  // derived every recompute
      lastScreen: null,             // last known screen pos, kept for invalid display
    };
    state.annotations.push(ann);
    recompute();
    return ann;
  }

  function deleteAnnotation(id) {
    const i = state.annotations.findIndex((a) => a.id === id);
    if (i >= 0) state.annotations.splice(i, 1);
  }

  function updateAnnotation(id, patch) {
    const ann = state.annotations.find((a) => a.id === id);
    if (!ann) return null;
    if (patch.text != null) ann.text = String(patch.text);
    if (patch.offset) ann.offset = { x: +patch.offset.x || 0, y: +patch.offset.y || 0 };
    return ann;
  }

  function setPartTransform(id, t) {
    const part = findPart(id);
    if (!part) return null;
    ['pos', 'rot', 'size', 'scale'].forEach((k) => {
      if (!t[k]) return;
      ['x', 'y', 'z'].forEach((ax) => {
        if (t[k][ax] != null && isFinite(+t[k][ax])) part[k][ax] = +t[k][ax];
      });
    });
    ['x', 'y', 'z'].forEach((ax) => { part.size[ax] = Math.max(0.01, part.size[ax]); });
    recompute();
    return part;
  }

  // Re-derive every annotation's world anchor from the part->world chain and
  // re-validate it against the part's current local bounds.
  function recompute() {
    for (const ann of state.annotations) {
      const part = findPart(ann.partId);
      if (!part) {
        ann.valid = false;
        ann.invalidReason = 'missing-part';
        ann.world = null;
        continue;
      }
      const hx = part.size.x / 2 + EPS, hy = part.size.y / 2 + EPS, hz = part.size.z / 2 + EPS;
      const l = ann.local;
      if (Math.abs(l.x) > hx || Math.abs(l.y) > hy || Math.abs(l.z) > hz) {
        ann.valid = false;
        ann.invalidReason = 'out-of-bounds';
        ann.world = null;
        continue;
      }
      ann.valid = true;
      ann.invalidReason = null;
      ann.world = M3.transformPoint(partMatrix(part), l);
    }
  }

  function serialize() {
    return JSON.stringify({
      parts: state.parts.map((p) => ({ id: p.id, name: p.name, pos: p.pos, rot: p.rot, size: p.size, scale: p.scale })),
      annotations: state.annotations.map((a) => ({ id: a.id, partId: a.partId, local: a.local, text: a.text, offset: a.offset })),
    }, null, 2);
  }

  function deserialize(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    state.parts.length = 0;
    state.annotations.length = 0;
    let maxP = 0, maxA = 0;
    for (const p of data.parts || []) {
      state.parts.push({
        id: p.id, name: p.name || p.id,
        pos: M3.v3(p.pos.x, p.pos.y, p.pos.z),
        rot: M3.v3(p.rot.x, p.rot.y, p.rot.z),
        size: M3.v3(p.size.x, p.size.y, p.size.z),
        scale: M3.v3(p.scale.x, p.scale.y, p.scale.z),
      });
      const n = parseInt(String(p.id).slice(1), 10); if (n > maxP) maxP = n;
    }
    for (const a of data.annotations || []) {
      state.annotations.push({
        id: a.id, partId: a.partId,
        local: M3.v3(a.local.x, a.local.y, a.local.z),
        text: a.text || a.id,
        offset: { x: +a.offset.x || 0, y: +a.offset.y || 0 },
        valid: false, invalidReason: null, world: null, lastScreen: null,
      });
      const n = parseInt(String(a.id).slice(1), 10); if (n > maxA) maxA = n;
    }
    nextPartId = maxP + 1; nextAnnId = maxA + 1;
    recompute();
  }

  return { state, createPart, findPart, deletePart, partMatrix, partInverse, createAnnotation, deleteAnnotation, updateAnnotation, setPartTransform, recompute, serialize, deserialize };
});
