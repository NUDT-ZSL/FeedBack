// Minimal THREE stand-in for offline state-chain verification.
// Only implements the API surface used by src/Loom.ts and src/ScrollViewer.ts.

export const DoubleSide = 2;

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  distanceTo(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  lerpVectors(a, b, t) {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }
}

export class Color {
  constructor(value = 0xffffff) {
    this.set(value);
  }
  set(value) {
    let hex = 0xffffff;
    if (typeof value === 'number') {
      hex = value;
    } else if (typeof value === 'string') {
      hex = parseInt(value.trim().replace('#', ''), 16);
    }
    if (!Number.isFinite(hex)) hex = 0;
    this.r = ((hex >> 16) & 0xff) / 255;
    this.g = ((hex >> 8) & 0xff) / 255;
    this.b = (hex & 0xff) / 255;
    return this;
  }
}

class Euler {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
}

export class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.userData = {};
    this.matrix = { elements: new Array(16).fill(0) };
  }
  add(...objects) {
    for (const obj of objects) {
      if (obj && !this.children.includes(obj)) {
        this.children.push(obj);
        obj.parent = this;
      }
    }
    return this;
  }
  remove(...objects) {
    for (const obj of objects) {
      const i = this.children.indexOf(obj);
      if (i >= 0) this.children.splice(i, 1);
      if (obj) obj.parent = null;
    }
    return this;
  }
  updateMatrix() {}
  clone() {
    const copy = new this.constructor(this.geometry, this.material);
    copy.position.copy(this.position);
    copy.rotation.x = this.rotation.x;
    copy.rotation.y = this.rotation.y;
    copy.rotation.z = this.rotation.z;
    copy.scale.copy(this.scale);
    copy.visible = this.visible;
    copy.userData = { ...this.userData };
    return copy;
  }
}

export class Group extends Object3D {}
export class Scene extends Object3D {}

class GeometryBase {
  constructor(...args) { this.args = args; this.attributes = {}; }
  dispose() {}
}

export class BufferGeometry extends GeometryBase {
  setFromPoints(points) {
    const array = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      array[i * 3] = p.x; array[i * 3 + 1] = p.y; array[i * 3 + 2] = p.z;
    });
    this.attributes.position = { array, needsUpdate: false };
    return this;
  }
}

export class BoxGeometry extends GeometryBase {}
export class PlaneGeometry extends GeometryBase {}
export class CylinderGeometry extends GeometryBase {}
export class ConeGeometry extends GeometryBase {}
export class SphereGeometry extends GeometryBase {}
export class CircleGeometry extends GeometryBase {}
export class ExtrudeGeometry extends GeometryBase {}

export class Shape {
  constructor() { this.curves = []; }
  absarc(x, y, radius, start, end) {
    this.curves.push({ type: 'absarc', x, y, radius, start, end });
    return this;
  }
}

export class Material {
  constructor(params = {}) {
    Object.assign(this, params);
    if (this.color !== undefined && !(this.color instanceof Color)) {
      this.color = new Color(this.color);
    }
  }
  clone() {
    const copy = new this.constructor();
    Object.assign(copy, this);
    return copy;
  }
  dispose() {}
}

export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class LineBasicMaterial extends Material {}

export class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

export class Line extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

export class InstancedBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.needsUpdate = false;
  }
}

export class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.count = count;
    this.instanceColor = null;
    this.instanceMatrix = { needsUpdate: false };
    this.matrices = new Map();
  }
  setMatrixAt(index, matrix) {
    this.matrices.set(index, matrix);
  }
}

export class PointLight extends Object3D {
  constructor(color = 0xffffff, intensity = 1, distance = 0) {
    super();
    this.color = new Color(color);
    this.intensity = intensity;
    this.distance = distance;
  }
}

export class Texture {
  constructor() { this.needsUpdate = false; }
  dispose() {}
}

export class CanvasTexture extends Texture {
  constructor(image) {
    super();
    this.image = image;
  }
}
