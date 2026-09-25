import * as THREE from 'three';
import { KLineData } from '../dataHandler';

/**
 * 单根 K 线柱体的所有网格与每帧动画状态。
 * 选中/悬停/详情模式等"交互状态"不放在这里，
 * 统一由 InteractionState 持有（单一可信来源）。
 */
export interface BarMeshGroup {
  body: THREE.Mesh;
  wickTop: THREE.Mesh;
  wickBottom: THREE.Mesh;
  volumeMesh: THREE.Mesh;
  edgeLines: THREE.LineSegments;
  data: KLineData;
  index: number;
  targetOpacity: number;
  currentOpacity: number;
  targetScale: THREE.Vector3;
  currentScale: THREE.Vector3;
  targetPosX: number;
  currentPosX: number;
  glowIntensity: number;
  isHighlighted: boolean;
}

export type BarHoverCallback = (data: KLineData | null, screenX: number, screenY: number) => void;
export type BarClickCallback = (data: KLineData | null) => void;
