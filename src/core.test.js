import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createAnnotation,
  createPart,
  evaluateAnnotation,
  getPartWorldMatrix,
  validateBoxAnchor,
  wouldCreatePartCycle,
} from "./core.js";

function camera() {
  const value = new THREE.PerspectiveCamera(55, 1, 0.05, 100);
  value.position.set(0, 0, 8);
  value.lookAt(0, 0, 0);
  value.updateMatrixWorld(true);
  return value;
}

test("局部锚点沿父子变换链转换到世界坐标", () => {
  const parent = createPart({
    name: "parent",
    position: [10, 0, 0],
    rotationDeg: [0, 0, 90],
    size: [2, 2, 2],
  });
  const child = createPart({
    name: "child",
    parentId: parent.id,
    position: [1, 0, 0],
    rotationDeg: [0, 0, 0],
    size: [1, 1, 1],
  });
  const chain = getPartWorldMatrix([parent, child], child.id);
  assert.equal(chain.error, null);
  const world = new THREE.Vector3(0.5, 0, 0).applyMatrix4(chain.matrix);
  assert.ok(Math.abs(world.x - 10) < 1e-6);
  assert.ok(Math.abs(world.y - 3) < 1e-6);
});

test("旋转和缩放不会改变锚点的局部表面位置", () => {
  const before = createPart({ name: "part", position: [0, 0, 0], size: [2, 4, 6] });
  const annotation = createAnnotation({ partId: before.id, anchor: [0.5, 0.25, 0.333333] });
  const first = evaluateAnnotation(annotation, [before], camera(), { width: 800, height: 600 });

  const moved = {
    ...before,
    position: [3, -1, 2],
    rotationDeg: [35, 90, -45],
    size: [4, 8, 12],
  };
  const second = evaluateAnnotation(annotation, [moved], camera(), { width: 800, height: 600 });

  assert.deepEqual(first.annotation.anchor, second.annotation.anchor);
  assert.equal(second.valid, true);
  assert.equal(second.reason, null);
});

test("越界和内部点被识别为无效，面内点保持有效", () => {
  assert.equal(validateBoxAnchor([2, 2, 2], [0.6, 0, 0]), "out-of-bounds");
  assert.equal(validateBoxAnchor([2, 2, 2], [0, 0, 0]), "off-surface");
  assert.equal(validateBoxAnchor([2, 2, 2], [0.5, 0, 0]), null);
  assert.equal(validateBoxAnchor([0, 2, 2], [0, 1, 1]), "bad-size");
});

test("部件删除后标注保留并返回缺失原因", () => {
  const annotation = createAnnotation({ partId: "gone", anchor: [0.5, 0, 0] });
  const result = evaluateAnnotation(annotation, [], camera(), { width: 800, height: 600 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing-part");
  assert.equal(result.worldAnchor, null);
});

test("有效表面锚点可以投影到屏幕坐标", () => {
  const part = createPart({ name: "part", size: [2, 2, 2] });
  const annotation = createAnnotation({ partId: part.id, anchor: [0.5, 0, 0] });
  const result = evaluateAnnotation(annotation, [part], camera(), { width: 800, height: 600 });
  assert.equal(result.valid, true);
  assert.ok(result.screenAnchor.visible);
  assert.ok(result.screenAnchor.x > 0 && result.screenAnchor.x < 800);
  assert.ok(result.screenAnchor.y > 0 && result.screenAnchor.y < 600);
});

test("可以识别会形成循环的父级选择", () => {
  const a = createPart({ name: "a" });
  const b = createPart({ name: "b", parentId: a.id });
  const c = createPart({ name: "c", parentId: b.id });
  assert.equal(wouldCreatePartCycle([a, b, c], a.id, c.id), true);
  assert.equal(wouldCreatePartCycle([a, b, c], c.id, a.id), false);
});
