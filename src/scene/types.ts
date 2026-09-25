import * as THREE from 'three';
import { KLineData } from '../dataHandler';

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
