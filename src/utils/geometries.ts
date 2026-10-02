import * as THREE from 'three';
import type { ComponentType } from '../types';

const TENON_DEPTH = 1;
const TENON_WIDTH = 4;
const TENON_HEIGHT = 2;

export const createWoodTexture = (baseColor: string): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, baseColor);
  gradient.addColorStop(0.5, lightenColor(baseColor, 10));
  gradient.addColorStop(1, darkenColor(baseColor, 15));
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 256;
    const width = Math.random() * 80 + 20;
    const alpha = Math.random() * 0.15 + 0.05;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      width * 0.3, y + (Math.random() - 0.5) * 10,
      width * 0.7, y + (Math.random() - 0.5) * 10,
      256, y + (Math.random() - 0.5) * 5
    );
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.lineWidth = Math.random() * 1.5 + 0.5;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

export const createGroundTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const baseColor = '#5a3a1a';
  for (let y = 0; y < 512; y += 32) {
    const gradient = ctx.createLinearGradient(0, y, 0, y + 32);
    gradient.addColorStop(0, darkenColor(baseColor, Math.random() * 10));
    gradient.addColorStop(0.5, baseColor);
    gradient.addColorStop(1, darkenColor(baseColor, Math.random() * 15));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, 512, 32);
    
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y + (Math.random() - 0.5) * 3);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
};

export const createGlowTexture = (): THREE.Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 215, 0, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 215, 0, 0.6)');
  gradient.addColorStop(0.6, 'rgba(255, 215, 0, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  return new THREE.CanvasTexture(canvas);
};

export const createCapBlockGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  const group = new THREE.Group();

  const mainBody = new THREE.Mesh(
    new THREE.BoxGeometry(width, height * 0.7, depth)
  );
  mainBody.position.y = 0;
  group.add(mainBody);

  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.8, height * 0.15, depth * 0.8)
  );
  topPlate.position.y = height * 0.425;
  group.add(topPlate);

  const bottomPlate = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.9, height * 0.15, depth * 0.9)
  );
  bottomPlate.position.y = -height * 0.425;
  group.add(bottomPlate);

  const mortiseGeo = new THREE.BoxGeometry(TENON_WIDTH + 2, TENON_HEIGHT + 1, depth * 0.6);
  const mortise1 = new THREE.Mesh(mortiseGeo);
  mortise1.position.set(0, height * 0.5, 0);
  mortise1.updateMatrix();
  mainBody.geometry = mergeGeometries(
    mainBody.geometry as THREE.BufferGeometry,
    mortiseGeo.clone().translate(0, height * 0.5, 0),
    true
  );

  const mortise2 = new THREE.Mesh(mortiseGeo.clone());
  mortise2.rotation.y = Math.PI / 2;
  mortise2.position.set(0, height * 0.5, 0);
  mortise2.updateMatrix();

  return mergeGroupGeometry(group);
};

export const createArchBracketGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  const group = new THREE.Group();

  const mainBody = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth)
  );
  group.add(mainBody);

  const tenonGeo = new THREE.BoxGeometry(TENON_WIDTH, TENON_HEIGHT, TENON_DEPTH);
  const tenon1 = new THREE.Mesh(tenonGeo);
  tenon1.position.set(0, -height / 2 - TENON_HEIGHT / 2, 0);
  group.add(tenon1);

  const mortiseGeo = new THREE.BoxGeometry(TENON_WIDTH + 1, TENON_HEIGHT + 1, TENON_DEPTH + 1);
  const mortise1 = new THREE.Mesh(mortiseGeo);
  mortise1.position.set(0, height / 2 + TENON_HEIGHT / 2, 0);
  mainBody.geometry = mergeGeometries(
    mainBody.geometry as THREE.BufferGeometry,
    mortiseGeo.clone().translate(0, height / 2 + TENON_HEIGHT / 2, 0),
    true
  );

  const endTenonGeo = new THREE.BoxGeometry(TENON_WIDTH, height * 0.6, TENON_DEPTH);
  const endTenon1 = new THREE.Mesh(endTenonGeo);
  endTenon1.position.set(-width / 2 - TENON_DEPTH / 2, 0, 0);
  group.add(endTenon1);

  const endTenon2 = new THREE.Mesh(endTenonGeo.clone());
  endTenon2.position.set(width / 2 + TENON_DEPTH / 2, 0, 0);
  group.add(endTenon2);

  return mergeGroupGeometry(group);
};

export const createCorbelBracketGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  const group = new THREE.Group();

  const mainBody = new THREE.Mesh(
    new THREE.BoxGeometry(width, height * 0.7, depth)
  );
  mainBody.position.y = 0;
  group.add(mainBody);

  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.85, height * 0.15, depth * 0.85)
  );
  topPlate.position.y = height * 0.425;
  group.add(topPlate);

  const bottomPlate = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.9, height * 0.15, depth * 0.9)
  );
  bottomPlate.position.y = -height * 0.425;
  group.add(bottomPlate);

  const mortiseGeo = new THREE.BoxGeometry(TENON_WIDTH + 1, TENON_HEIGHT + 1, depth * 0.5);
  const mortise = new THREE.Mesh(mortiseGeo);
  mortise.position.set(0, height * 0.5, 0);
  mainBody.geometry = mergeGeometries(
    mainBody.geometry as THREE.BufferGeometry,
    mortiseGeo.clone().translate(0, height * 0.5, 0),
    true
  );

  const tenonGeo = new THREE.BoxGeometry(TENON_WIDTH, TENON_HEIGHT, TENON_DEPTH);
  const tenon = new THREE.Mesh(tenonGeo);
  tenon.position.set(0, -height * 0.5 - TENON_HEIGHT / 2, 0);
  group.add(tenon);

  return mergeGroupGeometry(group);
};

export const createCantileverGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  const group = new THREE.Group();

  const mainBody = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth)
  );
  group.add(mainBody);

  const tenonGeo = new THREE.BoxGeometry(TENON_WIDTH, TENON_HEIGHT, TENON_DEPTH);
  const tenon = new THREE.Mesh(tenonGeo);
  tenon.position.set(0, -height / 2 - TENON_HEIGHT / 2, 0);
  group.add(tenon);

  const mortiseGeo = new THREE.BoxGeometry(TENON_WIDTH + 1, TENON_HEIGHT + 1, TENON_DEPTH + 1);
  const mortise = new THREE.Mesh(mortiseGeo);
  mortise.position.set(0, height / 2 + TENON_HEIGHT / 2, 0);
  mainBody.geometry = mergeGeometries(
    mainBody.geometry as THREE.BufferGeometry,
    mortiseGeo.clone().translate(0, height / 2 + TENON_HEIGHT / 2, 0),
    true
  );

  const frontShape = new THREE.Shape();
  const frontHeight = height * 0.8;
  const frontWidth = width;
  frontShape.moveTo(-frontWidth / 2, 0);
  frontShape.lineTo(frontWidth / 2, 0);
  frontShape.lineTo(frontWidth / 2 - 2, frontHeight);
  frontShape.quadraticCurveTo(0, frontHeight + 2, -frontWidth / 2 + 2, frontHeight);
  frontShape.lineTo(-frontWidth / 2, 0);

  const frontExtrude = new THREE.ExtrudeGeometry(frontShape, {
    depth: 2,
    bevelEnabled: false,
  });
  const front = new THREE.Mesh(frontExtrude);
  front.position.set(0, height / 2, depth / 2 + 1);
  group.add(front);

  return mergeGroupGeometry(group);
};

export const createSubstituteWoodGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  const group = new THREE.Group();

  const mainBody = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth)
  );
  group.add(mainBody);

  const tenonGeo = new THREE.BoxGeometry(TENON_WIDTH, TENON_HEIGHT, TENON_DEPTH);
  const tenon1 = new THREE.Mesh(tenonGeo);
  tenon1.position.set(0, -height / 2 - TENON_HEIGHT / 2, 0);
  group.add(tenon1);

  return mergeGroupGeometry(group);
};

export const createRafterGeometry = (width: number, height: number, depth: number): THREE.BufferGeometry => {
  return new THREE.BoxGeometry(width, height, depth);
};

export const createDougongGeometry = (
  type: ComponentType,
  width: number,
  height: number,
  depth: number
): THREE.BufferGeometry => {
  switch (type) {
    case 'CapBlock':
      return createCapBlockGeometry(width, height, depth);
    case 'ArchBracket':
      return createArchBracketGeometry(width, height, depth);
    case 'CorbelBracket':
      return createCorbelBracketGeometry(width, height, depth);
    case 'Cantilever':
      return createCantileverGeometry(width, height, depth);
    case 'SubstituteWood':
      return createSubstituteWoodGeometry(width, height, depth);
    case 'Rafter':
      return createRafterGeometry(width, height, depth);
    default:
      return new THREE.BoxGeometry(width, height, depth);
  }
};

function lightenColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return (
    '#' +
    (0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255))
      .toString(16)
      .slice(1)
  );
}

function darkenColor(color: string, percent: number): string {
  return lightenColor(color, -percent);
}

function mergeGroupGeometry(group: THREE.Group): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const geo = (child.geometry as THREE.BufferGeometry).clone();
      geo.applyMatrix4(child.matrix);
      geometries.push(geo);
    }
  });
  return mergeGeometries(geometries, false);
}

function mergeGeometries(
  geometries: THREE.BufferGeometry[],
  useGroups: boolean
): THREE.BufferGeometry {
  const mergedGeometry = new THREE.BufferGeometry();
  const attributes: Record<string, number[]> = {};
  let indexOffset = 0;
  const indexList: number[] = [];
  const groupList: { start: number; count: number; materialIndex: number }[] = [];

  for (let i = 0; i < geometries.length; i++) {
    const geometry = geometries[i];
    const geometryIndex = geometry.index;
    const geometryAttributes = geometry.attributes;

    if (useGroups) {
      groupList.push({
        start: indexOffset,
        count: geometryIndex ? geometryIndex.count : geometry.attributes.position.count,
        materialIndex: 0,
      });
    }

    for (const key in geometryAttributes) {
      if (geometryAttributes[key] === undefined) continue;

      if (attributes[key] === undefined) {
        attributes[key] = [];
      }

      const attribute = geometryAttributes[key] as THREE.BufferAttribute;
      const array = attribute.array as number[];
      const itemSize = attribute.itemSize;

      for (let j = 0; j < array.length; j++) {
        attributes[key].push(array[j]);
      }
    }

    if (geometryIndex) {
      const indices = geometryIndex.array as number[];
      for (let j = 0; j < indices.length; j++) {
        indexList.push(indices[j] + indexOffset);
      }
    } else {
      const positionCount = geometry.attributes.position.count;
      for (let j = 0; j < positionCount; j++) {
        indexList.push(j + indexOffset);
      }
    }

    indexOffset += geometry.attributes.position.count;
  }

  for (const key in attributes) {
    const typedArray = new Float32Array(attributes[key]);
    const itemSize = geometries[0].attributes[key].itemSize;
    mergedGeometry.setAttribute(key, new THREE.BufferAttribute(typedArray, itemSize));
  }

  mergedGeometry.setIndex(indexList);

  if (useGroups) {
    for (let i = 0; i < groupList.length; i++) {
      const group = groupList[i];
      mergedGeometry.addGroup(group.start, group.count, group.materialIndex);
    }
  }

  return mergedGeometry;
}
