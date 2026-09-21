import * as THREE from "three";

export const SURFACE_EPSILON = 1e-5;
export const LOCAL_BOX_SIZE = [1, 1, 1];

export const INVALID_REASONS = {
  "missing-part": "依附的部件已被删除",
  "missing-parent": "部件变换链中的父级部件已被删除",
  cycle: "部件父子关系形成循环",
  "bad-size": "部件尺寸必须全部为正数",
  "out-of-bounds": "锚点落在部件边界之外",
  "off-surface": "锚点不在部件表面",
};

let nextId = 1;
export function uid(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  const id = `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
  nextId += 1;
  return id;
}

export function createPart(overrides = {}) {
  return {
    id: overrides.id ?? uid("part"),
    name: overrides.name ?? "未命名部件",
    parentId: overrides.parentId ?? null,
    position: vector(overrides.position ?? [0, 0, 0]),
    rotationDeg: vector(overrides.rotationDeg ?? [0, 0, 0]),
    size: vector(overrides.size ?? [1, 1, 1]),
    color: overrides.color ?? "#4f8dd6",
  };
}

export function createAnnotation({ partId, anchor, text = "新标注", offset = { x: 22, y: -22 } }) {
  return {
    id: uid("ann"),
    partId,
    anchor: vector(anchor),
    text,
    offset: { x: offset?.x ?? 22, y: offset?.y ?? -22 },
    createdAt: new Date().toISOString(),
  };
}

export function vector(value) {
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

export function getPartById(parts, id) {
  return parts.find((part) => part.id === id) ?? null;
}

export function wouldCreatePartCycle(parts, partId, newParentId) {
  if (!newParentId || partId === newParentId) return partId === newParentId;
  let currentId = newParentId;
  const visited = new Set();
  while (currentId) {
    if (currentId === partId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = getPartById(parts, currentId)?.parentId ?? null;
  }
  return false;
}

export function partMatrix(part) {
  const position = new THREE.Vector3(...part.position);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(part.rotationDeg[0]),
      THREE.MathUtils.degToRad(part.rotationDeg[1]),
      THREE.MathUtils.degToRad(part.rotationDeg[2]),
    ),
  );
  const scale = new THREE.Vector3(...part.size);
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

export function getPartWorldMatrix(parts, partId, cache = new Map(), visiting = new Set()) {
  if (cache.has(partId)) return { matrix: cache.get(partId), error: null };
  const part = getPartById(parts, partId);
  if (!part) return { matrix: null, error: "missing-part" };
  if (visiting.has(partId)) return { matrix: null, error: "cycle" };
  visiting.add(partId);

  const local = partMatrix(part);
  if (!part.parentId) {
    cache.set(partId, local.clone());
    return { matrix: local.clone(), error: null };
  }

  const parent = getPartWorldMatrix(parts, part.parentId, cache, visiting);
  if (parent.error) return { matrix: null, error: parent.error === "missing-part" ? "missing-parent" : parent.error };
  const world = parent.matrix.clone().multiply(local);
  cache.set(partId, world);
  visiting.delete(partId);
  return { matrix: world, error: null };
}

export function validateBoxAnchor(size, anchor) {
  if (size.some((value) => !Number.isFinite(value) || value <= 0)) return "bad-size";
  const half = LOCAL_BOX_SIZE.map((value) => value / 2);
  const inside = anchor.every((value, index) =>
    Number.isFinite(value) && Math.abs(value) <= half[index] + SURFACE_EPSILON);
  if (!inside) return "out-of-bounds";

  const onFace = anchor.some((value, index) => Math.abs(Math.abs(value) - half[index]) <= SURFACE_EPSILON);
  return onFace ? null : "off-surface";
}

export function boxFaceNormal(anchor, size) {
  const half = LOCAL_BOX_SIZE.map((value) => value / 2);
  let axis = 0;
  let distance = -Infinity;
  for (let index = 0; index < 3; index += 1) {
    const faceDistance = Math.abs(Math.abs(anchor[index]) - half[index]);
    if (faceDistance > distance) {
      distance = faceDistance;
      axis = index;
    }
  }
  const normal = [0, 0, 0];
  normal[axis] = anchor[axis] >= 0 ? 1 : -1;
  return normal;
}

export function projectWorldPoint(worldPoint, camera, viewport) {
  const cameraPosition = new THREE.Vector3();
  camera.getWorldPosition(cameraPosition);
  camera.updateWorldMatrix(true, false);
  const viewMatrix = camera.matrixWorld.clone().invert();

  const viewPoint = new THREE.Vector4(worldPoint.x, worldPoint.y, worldPoint.z, 1).applyMatrix4(viewMatrix);
  const clipPoint = viewPoint.clone().applyMatrix4(camera.projectionMatrix);
  if (viewPoint.z >= 0 || clipPoint.w <= 0) {
    return {
      visible: false,
      behindCamera: true,
      x: viewport.width / 2,
      y: viewport.height / 2,
      ndc: null,
      distance: cameraPosition.distanceTo(worldPoint),
    };
  }

  const ndcX = clipPoint.x / clipPoint.w;
  const ndcY = clipPoint.y / clipPoint.w;
  return {
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
    behindCamera: false,
    x: (ndcX * 0.5 + 0.5) * viewport.width,
    y: (-ndcY * 0.5 + 0.5) * viewport.height,
      ndc: { x: ndcX, y: ndcY, z: clipPoint.z / clipPoint.w },
    distance: cameraPosition.distanceTo(worldPoint),
  };
}

export function evaluateAnnotation(annotation, parts, camera, viewport, matrixCache = new Map()) {
  const part = getPartById(parts, annotation.partId);
  const base = {
    annotation,
    part,
    valid: false,
    reason: null,
    worldAnchor: null,
    worldNormal: null,
    screenAnchor: null,
    facingCamera: false,
    occluded: false,
  };

  if (!part) return { ...base, reason: "missing-part" };
  if (!Array.isArray(annotation.anchor) || annotation.anchor.length !== 3) {
    return { ...base, reason: "out-of-bounds" };
  }

  const sizeError = part.size.some((value) => !Number.isFinite(value) || value <= 0) ? "bad-size" : null;
  if (sizeError) return { ...base, reason: sizeError };

  const anchorReason = validateBoxAnchor(part.size, annotation.anchor);
  const chain = getPartWorldMatrix(parts, part.id, matrixCache);
  if (chain.error) return { ...base, reason: chain.error };

  const localAnchor = new THREE.Vector3(...annotation.anchor);
  const worldAnchor = localAnchor.clone().applyMatrix4(chain.matrix);
  const faceNormal = boxFaceNormal(annotation.anchor, part.size);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(chain.matrix);
  const worldNormal = new THREE.Vector3(...faceNormal).applyMatrix3(normalMatrix).normalize();
  const screenAnchor = projectWorldPoint(worldAnchor, camera, viewport);

  const cameraPosition = new THREE.Vector3();
  camera.getWorldPosition(cameraPosition);
  const toCamera = cameraPosition.clone().sub(worldAnchor).normalize();
  const facingCamera = worldNormal.dot(toCamera) > 0;

  return {
    ...base,
    valid: anchorReason === null,
    reason: anchorReason,
    worldAnchor,
    worldNormal,
    screenAnchor,
    facingCamera,
  };
}

export function updateAnnotationText(annotation, text) {
  return { ...annotation, text };
}

export function updateAnnotationOffset(annotation, x, y) {
  return { ...annotation, offset: { x: Number(x), y: Number(y) } };
}
