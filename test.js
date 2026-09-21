/* test.js - headless verification of the math + scene layers (run: node test.js) */
'use strict';
const M3 = require('./math3d.js');
const S = require('./scene.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
const close = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const vclose = (a, b, eps) => close(a.x, b.x, eps) && close(a.y, b.y, eps) && close(a.z, b.z, eps);

console.log('[1] TRS compose/invert roundtrip');
{
  const p = { x: 1, y: -2, z: 3 }, r = { x: 30, y: -45, z: 70 }, s = { x: 2, y: 0.5, z: 1.5 };
  const m = M3.composeTRS(p, r, s), inv = M3.invertTRS(p, r, s);
  const pt = { x: 0.3, y: -0.7, z: 1.1 };
  ok(vclose(M3.transformPoint(inv, M3.transformPoint(m, pt)), pt, 1e-9), 'inverse(compose)*p == p');
}

console.log('[2] anchor stays on the same local surface point after rotate/scale (req 4)');
{
  const part = S.createPart({ pos: { x: 0, y: 1, z: 0 }, size: { x: 2, y: 1, z: 1 } });
  const local = { x: 1, y: 0.2, z: -0.3 }; // on +X face (size.x/2 = 1)
  const ann = S.createAnnotation(part.id, local, 't');
  ok(ann.valid, 'annotation valid on surface');
  const before = { ...ann.world };
  S.setPartTransform(part.id, { rot: { x: 0, y: 90, z: 25 }, scale: { x: 3, y: 1, z: 1 }, pos: { x: 5, y: 0, z: -2 } });
  ok(ann.valid, 'still valid after transform');
  ok(!vclose(ann.world, before), 'world position recomputed (moved with part)');
  // local anchor unchanged, and inverse-mapping the world point returns the same local point
  ok(vclose(ann.local, local), 'local anchor unchanged');
  const inv = S.partInverse(S.findPart(part.id));
  ok(vclose(M3.transformPoint(inv, ann.world), local, 1e-9), 'world -> local roundtrip matches anchor');
  // scaled world anchor sits on the scaled surface: |local.x|*scale.x == size.x/2*scale.x
  ok(close(ann.local.x * 3, (part.size.x / 2) * 3), 'anchor remains on scaled surface');
}

console.log('[3] invalidation: part deleted / anchor out of bounds (req 5)');
{
  const part = S.createPart({ pos: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } });
  const a1 = S.createAnnotation(part.id, { x: 0.5, y: 0, z: 0 }, 'edge');
  ok(a1.valid, 'valid at face');
  S.setPartTransform(part.id, { size: { x: 0.6, y: 1, z: 1 } }); // shrink: x=0.5 now outside
  ok(!a1.valid && a1.invalidReason === 'out-of-bounds', 'out-of-bounds after shrink');
  S.setPartTransform(part.id, { size: { x: 2, y: 1, z: 1 } }); // grow back
  ok(a1.valid, 'recovers when bounds contain anchor again');
  S.deletePart(part.id);
  ok(!a1.valid && a1.invalidReason === 'missing-part', 'missing-part after delete');
  ok(S.state.annotations.includes(a1), 'invalid annotation is kept, not dropped');
}

console.log('[4] ray/OBB picking returns a local on-surface anchor (req 2)');
{
  const part = S.createPart({ pos: { x: 2, y: 0, z: 0 }, rot: { x: 0, y: 45, z: 0 }, size: { x: 2, y: 2, z: 2 } });
  const inv = S.partInverse(part);
  const ray = { origin: { x: 2, y: 10, z: 0 }, dir: { x: 0, y: -1, z: 0 } };
  const ro = M3.transformPoint(inv, ray.origin);
  const rd = M3.transformDir(inv, ray.dir);
  const hit = M3.rayBox(ro, rd, { x: 1, y: 1, z: 1 });
  ok(!!hit, 'ray hits rotated box');
  ok(hit && close(hit.point.y, 1, 1e-9), 'hit point lies on +Y face in local frame');
  ok(hit && Math.abs(hit.point.x) <= 1 + 1e-9 && Math.abs(hit.point.z) <= 1 + 1e-9, 'hit within local bounds');
}

console.log('[5] serialize/deserialize preserves anchors and validity');
{
  const json = S.serialize();
  const before = S.state.annotations.map((a) => ({ id: a.id, valid: a.valid, local: a.local }));
  S.deserialize(json);
  const after = S.state.annotations.map((a) => ({ id: a.id, valid: a.valid, local: a.local }));
  ok(JSON.stringify(before) === JSON.stringify(after), 'roundtrip keeps annotations identical');
}

console.log('[6] per-annotation update does not touch others (req 6)');
{
  const p = S.createPart({ pos: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } });
  const a = S.createAnnotation(p.id, { x: 0.5, y: 0, z: 0 }, 'one');
  const b = S.createAnnotation(p.id, { x: -0.5, y: 0, z: 0 }, 'two');
  const bSnapshot = JSON.stringify(b);
  S.updateAnnotation(a.id, { text: 'edited', offset: { x: 10, y: -20 } });
  ok(a.text === 'edited' && a.offset.x === 10 && a.offset.y === -20, 'target annotation updated');
  ok(JSON.stringify(b) === bSnapshot, 'other annotation untouched');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
