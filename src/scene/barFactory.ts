import * as THREE from 'three';
import { KLineData } from '../dataHandler';
import { BarMeshGroup } from './types';

/**
 * 柱体构建层：根据 K 线数据计算布局并创建网格。
 * 只做"创建"，不负责把网格挂进场景（由 BarCollection 负责），
 * 因此可以独立测试，也不会在构建阶段产生场景副作用。
 */
export function buildKLineBars(data: KLineData[]): BarMeshGroup[] {
  const priceAll = data.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...priceAll);
  const maxPrice = Math.max(...priceAll);
  const priceRange = maxPrice - minPrice || 1;
  const maxVolume = Math.max(...data.map(d => d.volume));
  const heightScale = 8 / priceRange;
  const volumeScale = 2 / maxVolume;
  const spacing = 0.55;
  const offsetX = (data.length * spacing) / 2;

  return data.map((kline, i) => {
    const isUp = kline.close >= kline.open;
    const color = isUp ? 0x00e676 : 0xff1744;
    const emissiveColor = isUp ? 0x003d1a : 0x4a0011;
    const posX = i * spacing - offsetX;

    const bodyMin = Math.min(kline.open, kline.close);
    const bodyMax = Math.max(kline.open, kline.close);
    const bodyHeight = Math.max((bodyMax - bodyMin) * heightScale, 0.05);
    const bodyY = (bodyMin - minPrice) * heightScale + bodyHeight / 2;

    const bodyGeom = new THREE.BoxGeometry(0.38, bodyHeight, 0.38);
    const bodyMat = new THREE.MeshPhongMaterial({
      color,
      emissive: emissiveColor,
      emissiveIntensity: 0.15,
      specular: 0x666666,
      shininess: 60,
      transparent: true,
      opacity: 0,
    });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    bodyMesh.position.set(posX, bodyY, 0);

    const edgeGeom = new THREE.EdgesGeometry(bodyGeom);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0 });
    const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
    bodyMesh.add(edgeLines);

    const wickTopHeight = Math.max((kline.high - bodyMax) * heightScale, 0.01);
    const wickTopGeom = new THREE.BoxGeometry(0.04, wickTopHeight, 0.04);
    const wickMat = new THREE.MeshPhongMaterial({
      color,
      emissive: emissiveColor,
      emissiveIntensity: 0.1,
      specular: 0x444444,
      shininess: 40,
      transparent: true,
      opacity: 0,
    });
    const wickTop = new THREE.Mesh(wickTopGeom, wickMat);
    const wickTopY = (bodyMax - minPrice) * heightScale + wickTopHeight / 2;
    wickTop.position.set(posX, wickTopY, 0);

    const wickBottomHeight = Math.max((bodyMin - kline.low) * heightScale, 0.01);
    const wickBottomGeom = new THREE.BoxGeometry(0.04, wickBottomHeight, 0.04);
    const wickBottom = new THREE.Mesh(wickBottomGeom, wickMat.clone());
    const wickBottomY = (kline.low - minPrice) * heightScale + wickBottomHeight / 2;
    wickBottom.position.set(posX, wickBottomY, 0);

    const volumeHeight = Math.max(kline.volume * volumeScale, 0.01);
    const volumeGeom = new THREE.BoxGeometry(0.34, volumeHeight, 0.34);
    const volumeMat = new THREE.MeshPhongMaterial({
      color: 0x3c82ff,
      emissive: 0x0a1a40,
      emissiveIntensity: 0.1,
      specular: 0x222244,
      shininess: 30,
      transparent: true,
      opacity: 0,
    });
    const volumeMesh = new THREE.Mesh(volumeGeom, volumeMat);
    volumeMesh.position.set(posX, -volumeHeight / 2, 0);

    bodyMesh.userData = { barIndex: i };

    return {
      body: bodyMesh,
      wickTop,
      wickBottom,
      volumeMesh,
      edgeLines,
      data: kline,
      index: i,
      targetOpacity: 1,
      currentOpacity: 0,
      targetScale: new THREE.Vector3(1, 1, 1),
      currentScale: new THREE.Vector3(1, 1, 1),
      targetPosX: posX,
      currentPosX: posX + 3,
      glowIntensity: 0,
      isHighlighted: false,
    };
  });
}
