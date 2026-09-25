import * as THREE from 'three';
import { KLineData } from '../dataHandler';
import { BarMeshGroup } from './types';

const SPACING = 0.55;

interface LayoutInfo {
  minPrice: number;
  heightScale: number;
  volumeScale: number;
  offsetX: number;
}

function computeLayout(data: KLineData[]): LayoutInfo {
  const priceAll = data.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...priceAll);
  const maxPrice = Math.max(...priceAll);
  const priceRange = maxPrice - minPrice || 1;
  const maxVolume = Math.max(...data.map(d => d.volume));
  return {
    minPrice,
    heightScale: 8 / priceRange,
    volumeScale: 2 / maxVolume,
    offsetX: (data.length * SPACING) / 2,
  };
}

function createBodyMaterial(color: number, emissiveColor: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color,
    emissive: emissiveColor,
    emissiveIntensity: 0.15,
    specular: 0x666666,
    shininess: 60,
    transparent: true,
    opacity: 0,
  });
}

function createWickMaterial(color: number, emissiveColor: number): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color,
    emissive: emissiveColor,
    emissiveIntensity: 0.1,
    specular: 0x444444,
    shininess: 40,
    transparent: true,
    opacity: 0,
  });
}

function createVolumeMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: 0x3c82ff,
    emissive: 0x0a1a40,
    emissiveIntensity: 0.1,
    specular: 0x222244,
    shininess: 30,
    transparent: true,
    opacity: 0,
  });
}

function createBar(kline: KLineData, index: number, layout: LayoutInfo): BarMeshGroup {
  const { minPrice, heightScale, volumeScale, offsetX } = layout;
  const isUp = kline.close >= kline.open;
  const color = isUp ? 0x00e676 : 0xff1744;
  const emissiveColor = isUp ? 0x003d1a : 0x4a0011;
  const posX = index * SPACING - offsetX;

  const bodyMin = Math.min(kline.open, kline.close);
  const bodyMax = Math.max(kline.open, kline.close);
  const bodyHeight = Math.max((bodyMax - bodyMin) * heightScale, 0.05);
  const bodyY = (bodyMin - minPrice) * heightScale + bodyHeight / 2;

  const bodyGeom = new THREE.BoxGeometry(0.38, bodyHeight, 0.38);
  const bodyMesh = new THREE.Mesh(bodyGeom, createBodyMaterial(color, emissiveColor));
  bodyMesh.position.set(posX, bodyY, 0);

  const edgeGeom = new THREE.EdgesGeometry(bodyGeom);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0 });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  bodyMesh.add(edgeLines);

  const wickTopHeight = Math.max((kline.high - bodyMax) * heightScale, 0.01);
  const wickTopGeom = new THREE.BoxGeometry(0.04, wickTopHeight, 0.04);
  const wickTop = new THREE.Mesh(wickTopGeom, createWickMaterial(color, emissiveColor));
  wickTop.position.set(posX, (bodyMax - minPrice) * heightScale + wickTopHeight / 2, 0);

  const wickBottomHeight = Math.max((bodyMin - kline.low) * heightScale, 0.01);
  const wickBottomGeom = new THREE.BoxGeometry(0.04, wickBottomHeight, 0.04);
  const wickBottom = new THREE.Mesh(wickBottomGeom, createWickMaterial(color, emissiveColor));
  wickBottom.position.set(posX, (kline.low - minPrice) * heightScale + wickBottomHeight / 2, 0);

  const volumeHeight = Math.max(kline.volume * volumeScale, 0.01);
  const volumeGeom = new THREE.BoxGeometry(0.34, volumeHeight, 0.34);
  const volumeMesh = new THREE.Mesh(volumeGeom, createVolumeMaterial());
  volumeMesh.position.set(posX, -volumeHeight / 2, 0);

  bodyMesh.userData = { barIndex: index };

  return {
    body: bodyMesh,
    wickTop,
    wickBottom,
    volumeMesh,
    edgeLines,
    data: kline,
    index,
    targetOpacity: 1,
    currentOpacity: 0,
    targetScale: new THREE.Vector3(1, 1, 1),
    currentScale: new THREE.Vector3(1, 1, 1),
    targetPosX: posX,
    currentPosX: posX + 3,
    glowIntensity: 0,
    isHighlighted: false,
  };
}

export function createBars(data: KLineData[]): BarMeshGroup[] {
  const layout = computeLayout(data);
  return data.map((kline, i) => createBar(kline, i, layout));
}
